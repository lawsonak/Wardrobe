import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { validateUploadFile, unlinkUpload } from "@/lib/uploads";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";
// AI detection + sharp crop + write can take a few seconds on a big
// iPhone screenshot. Generous headroom; the route is per-user
// interactive so a hung call shouldn't bottleneck other users.
export const maxDuration = 60;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const DISPLAY_MAX_EDGE_PX = 1024;
// Padding around the Gemini box — Gemini sometimes shaves a few
// pixels off the garment's edge, and the bg-removal pass downstream
// benefits from a margin of context. Matches the closet's split
// route's value so we don't ship two different padding policies.
const PAD_PCT = 0.04;

// Per-shop-item photo replacement. Accepts a multipart image and
// (optionally) runs it through Gemini's object detection — same
// detector the closet's "✂ Split photo" flow uses — to crop out
// just the clothing region. Useful when the user took an Amazon
// screenshot: the Amazon search bar, product title, and nav chrome
// get cropped away and we keep the garment.
//
// Fallbacks:
//   - AI disabled        → save the upload as-is (resized + EXIF-baked)
//   - Detection empty    → save as-is
//   - Detection errors   → save as-is and log
//
// Replacing the photo invalidates any cached try-on render — the
// hash includes the file's mtime, so the next /tryon call would
// regenerate anyway, but we also null the columns + unlink the
// stale render proactively so the user doesn't see an out-of-date
// composite for the new garment.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shopItemId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, shopItemId } = await params;

  // Owner-scope check via the parent collection.
  const existing = await prisma.collectionShopItem.findFirst({
    where: { id: shopItemId, collectionId: id, collection: { ownerId: userId } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  const fileErr = validateUploadFile(image);
  if (fileErr) return NextResponse.json({ error: fileErr }, { status: 400 });

  const sourceBytes = Buffer.from(await image.arrayBuffer());

  // Try AI auto-crop first. Any failure mode falls through to "save
  // the whole upload" — we always end up with SOMETHING saved on the
  // shop item, even on a detection miss.
  let cropBuf: Buffer | null = null;
  let detectionUsed = false;
  const provider = getProvider();
  if (provider.available() && typeof provider.detectMultipleItems === "function") {
    try {
      const meta = await sharp(sourceBytes, { failOn: "none" }).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      if (W > 0 && H > 0) {
        // Re-encode as a clean JPEG for detection so Gemini doesn't
        // choke on iPhone HEIC variants or unusual color profiles.
        // We still crop from the original bytes downstream — better
        // pixel fidelity than the JPEG round-trip.
        const detectJpeg = await sharp(sourceBytes, { failOn: "none" })
          .rotate()
          .jpeg({ quality: 88 })
          .toBuffer();
        const detectBlob = new Blob([new Uint8Array(detectJpeg)], { type: "image/jpeg" });
        const result = await provider.detectMultipleItems({ image: detectBlob });
        // Pick the largest detected box — when a user screenshots an
        // Amazon product page there's usually one dominant garment
        // and we want that one, not random small detections.
        let bestBox: [number, number, number, number] | null = null;
        let bestArea = 0;
        for (const item of result.items) {
          const [ymin, xmin, ymax, xmax] = item.box;
          const area = (ymax - ymin) * (xmax - xmin);
          if (area > bestArea) {
            bestArea = area;
            bestBox = item.box;
          }
        }
        // Require the box to cover at least 5% of the image — a tiny
        // detection on a screenshot probably means the model latched
        // onto something incidental (a logo, an icon). Save as-is in
        // that case so the user doesn't end up with a pixel-level
        // crop of an Amazon "a" logo.
        if (bestBox && bestArea / 1_000_000 > 0.05) {
          const pad = Math.round(PAD_PCT * Math.min(W, H));
          const [ymin, xmin, ymax, xmax] = bestBox;
          const left = Math.max(0, Math.round((xmin / 1000) * W) - pad);
          const top = Math.max(0, Math.round((ymin / 1000) * H) - pad);
          const right = Math.min(W, Math.round((xmax / 1000) * W) + pad);
          const bottom = Math.min(H, Math.round((ymax / 1000) * H) + pad);
          const cw = right - left;
          const ch = bottom - top;
          if (cw > 0 && ch > 0) {
            cropBuf = await sharp(sourceBytes, { failOn: "none" })
              .rotate()
              .extract({ left, top, width: cw, height: ch })
              .resize({
                width: DISPLAY_MAX_EDGE_PX,
                height: DISPLAY_MAX_EDGE_PX,
                fit: "inside",
                withoutEnlargement: true,
              })
              .jpeg({ quality: 88, mozjpeg: true })
              .toBuffer();
            detectionUsed = true;
          }
        }
      }
    } catch (err) {
      // Any detection failure → quietly fall through. We log so the
      // server still surfaces the cause in dev, but the user gets
      // their upload saved either way.
      console.error("shop-item photo detect failed:", err);
    }
  }

  // Fallback: save the whole upload, rotated + resized.
  if (!cropBuf) {
    cropBuf = await sharp(sourceBytes, { failOn: "none" })
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE_PX,
        height: DISPLAY_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }

  const userDir = path.join(UPLOAD_ROOT, userId, "collection-shop");
  await fs.mkdir(userDir, { recursive: true });
  // New filename per upload so the browser's HTTP cache doesn't show
  // the old image for the same URL — same trick the outfit try-on
  // route uses with a hash-based filename.
  const stamp = Date.now().toString(36);
  const filename = `${existing.id}-img-${stamp}.jpg`;
  await fs.writeFile(path.join(userDir, filename), cropBuf);
  const relPath = path.posix.join(userId, "collection-shop", filename);

  // Clean up the previous image + try-on render. These are best-effort
  // — a missing file just means the cleanup ran earlier; nothing to do.
  await unlinkUpload(existing.imagePath);
  await unlinkUpload(existing.tryOnImagePath);

  const updated = await prisma.collectionShopItem.update({
    where: { id: existing.id },
    data: {
      imagePath: relPath,
      tryOnImagePath: null,
      tryOnHash: null,
      tryOnGeneratedAt: null,
    },
  });

  return NextResponse.json({
    item: updated,
    detectionUsed,
  });
}
