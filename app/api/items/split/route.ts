import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BEAUTY_CATEGORIES, COLOR_NAMES, isKnownCategory } from "@/lib/constants";
import { saveUploadWithOriginal, computeDHash, validateUploadFile } from "@/lib/uploads";
import { runHiResBgRemovalBatch } from "@/lib/bgRemovalServer";
import { logActivity } from "@/lib/activity";
import { brandKey } from "@/lib/brand";

export const runtime = "nodejs";
// Sharp crops + sequential per-item creates can take a few seconds for
// large source images. Generous headroom.
export const maxDuration = 120;

// Multipart POST. Accepts:
//   - image (File)     — the original flat-lay
//   - detections (str) — JSON array; see DetectionInput type below
//
// For each detection, the route crops the original to the bounding
// box, runs sharp to write display + original two-tier variants, and
// creates an Item with the tagged fields the picker carried through.
// Hi-res bg-removed cutouts populate in the background via
// runHiResBgRemovalBatch — same pattern as /api/items/bulk.
//
// Items land active and visible immediately. The user can re-edit any
// field per-item from the regular edit page.

type DetectionInput = {
  /** [ymin, xmin, ymax, xmax] in 0–1000 Gemini-normalized coords. */
  box: [number, number, number, number];
  category: string;
  subType?: string;
  color?: string;
  brand?: string;
  isBeauty?: boolean;
  shadeName?: string;
  shadeHex?: string;
  finish?: string;
  /** Batch-level override. The picker exposes a 🌶 toggle per detection. */
  isBackroom?: boolean;
};

// Crop padding around each detected box — 4% of the smaller image
// dimension. Tight boxes from Gemini sometimes shave a few pixels off
// the edges; a small margin makes crops feel less amputated and gives
// the bg-removal pass more context to work with.
const PAD_PCT = 0.04;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  const fileErr = validateUploadFile(image);
  if (fileErr) return NextResponse.json({ error: fileErr }, { status: 400 });

  const detectionsRaw = form.get("detections");
  if (typeof detectionsRaw !== "string") {
    return NextResponse.json({ error: "Missing detections" }, { status: 400 });
  }
  let detections: DetectionInput[] = [];
  try {
    const parsed = JSON.parse(detectionsRaw);
    if (Array.isArray(parsed)) detections = parsed as DetectionInput[];
  } catch {
    return NextResponse.json({ error: "Invalid detections JSON" }, { status: 400 });
  }
  if (detections.length === 0) {
    return NextResponse.json({ error: "No detections selected" }, { status: 400 });
  }
  if (detections.length > 24) {
    return NextResponse.json({ error: "Up to 24 detections per call" }, { status: 400 });
  }

  // Decode the source image once. Sharp gives us metadata + extract
  // for in-memory crops; no temp file needed.
  const sourceBytes = Buffer.from(await image.arrayBuffer());
  const meta = await sharp(sourceBytes, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) {
    return NextResponse.json({ error: "Couldn't read image dimensions" }, { status: 400 });
  }
  const W = meta.width;
  const H = meta.height;
  const pad = Math.round(Math.min(W, H) * PAD_PCT);

  const created: Array<{ id: string; imagePath: string }> = [];
  const errors: Array<{ index: number; error: string }> = [];

  // Sequential so a 12-item split doesn't hammer sharp's worker pool
  // and Prisma's write queue at the same time. Each crop is small,
  // total wall time still well under maxDuration for normal batches.
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    try {
      const category = String(d.category || "").trim();
      if (!isKnownCategory(category)) {
        errors.push({ index: i, error: `Unknown category "${category}"` });
        continue;
      }
      const isBeauty =
        d.isBeauty === true ||
        (BEAUTY_CATEGORIES as readonly string[]).includes(category);

      // Convert normalized box → pixel rect, clamp + pad to image bounds.
      const [ymin, xmin, ymax, xmax] = d.box;
      const left = Math.max(0, Math.round((xmin / 1000) * W) - pad);
      const top = Math.max(0, Math.round((ymin / 1000) * H) - pad);
      const right = Math.min(W, Math.round((xmax / 1000) * W) + pad);
      const bottom = Math.min(H, Math.round((ymax / 1000) * H) + pad);
      const cropWidth = right - left;
      const cropHeight = bottom - top;
      if (cropWidth <= 0 || cropHeight <= 0) {
        errors.push({ index: i, error: "Degenerate bounding box" });
        continue;
      }

      const cropBuf = await sharp(sourceBytes, { failOn: "none" })
        .extract({ left, top, width: cropWidth, height: cropHeight })
        // Re-encode as JPEG — saveUploadWithOriginal can handle PNG too,
        // but JPEG keeps file sizes sane and matches the rest of the
        // upload flow. Quality 88 gives a comfortable middle ground.
        .jpeg({ quality: 88 })
        .toBuffer();

      // Validate color / brand before insert so we don't write garbage.
      const colorRaw = (d.color ?? "").toLowerCase().trim();
      const color = (COLOR_NAMES as readonly string[]).includes(colorRaw)
        ? colorRaw
        : null;
      const subType = (d.subType ?? "").trim().slice(0, 100) || null;
      const brandText = (d.brand ?? "").trim().slice(0, 80) || null;
      const isBackroom = d.isBackroom === true;

      // Beauty-only fields. Hex pattern matches the single-add form's
      // validator — accept "#abcdef" or "abcdef", store as lowercase
      // "#abcdef"; anything else drops to null.
      const shadeName = isBeauty && d.shadeName
        ? d.shadeName.trim().slice(0, 80) || null
        : null;
      const shadeHex = (() => {
        if (!isBeauty || !d.shadeHex) return null;
        const m = d.shadeHex.trim().match(/^#?([0-9a-f]{6})$/i);
        return m ? `#${m[1].toLowerCase()}` : null;
      })();
      const finish = isBeauty && d.finish
        ? d.finish.trim().slice(0, 60) || null
        : null;

      // Resolve brand via upsert (same approach as /api/items POST).
      let brandId: string | null = null;
      let brandFinal: string | null = brandText;
      if (brandText) {
        const key = brandKey(brandText);
        if (key) {
          const upserted = await prisma.brand.upsert({
            where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
            update: {},
            create: { ownerId: userId, name: brandText, nameKey: key },
          });
          brandId = upserted.id;
          brandFinal = upserted.name;
        }
      }

      const placeholder = await prisma.item.create({
        data: {
          ownerId: userId,
          imagePath: "pending",
          category,
          subType,
          color,
          brand: brandFinal,
          brandId,
          isBackroom,
          isBeauty,
          shadeName,
          shadeHex,
          finish,
          status: "active",
        },
      });

      // saveUploadWithOriginal wants a File; wrap the cropped buffer.
      // File-write failure deletes the placeholder so a broken
      // imagePath="pending" tile can't land in the closet; the
      // detection is reported in `errors` instead.
      const cropFile = new File([new Uint8Array(cropBuf)], `crop-${i}.jpg`, {
        type: "image/jpeg",
      });
      let updated;
      try {
        const { displayPath, originalPath } = await saveUploadWithOriginal(
          userId,
          placeholder.id,
          cropFile,
          "orig",
        );
        const phash = await computeDHash(cropBuf);
        updated = await prisma.item.update({
          where: { id: placeholder.id },
          data: { imagePath: displayPath, imageOriginalPath: originalPath, phash },
        });
      } catch (err) {
        await prisma.item.delete({ where: { id: placeholder.id } }).catch(() => {});
        throw err;
      }
      created.push({ id: updated.id, imagePath: updated.imagePath });
    } catch (err) {
      console.error("split: detection failed", err);
      errors.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (created.length > 0) {
    await logActivity({
      userId,
      kind: "item.bulk-create",
      summary: `Split one photo into ${created.length} item${created.length === 1 ? "" : "s"}`,
      meta: { count: created.length, source: "split" },
    });

    // Hi-res cutout pass runs in the background — items show up
    // immediately with their cropped photo; cutouts populate over the
    // next minute or two. Same pattern as /api/items/bulk.
    const ids = created.map((c) => c.id);
    void runHiResBgRemovalBatch(prisma, userId, ids).catch((err) => {
      console.warn("hi-res bg removal kick-off failed (split):", err);
    });
  }

  return NextResponse.json({ created, count: created.length, errors }, { status: 201 });
}
