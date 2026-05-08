import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, listToCsv } from "@/lib/constants";
import { brandKey } from "@/lib/brand";
import {
  saveUpload,
  saveUploadWithOriginal,
  computeDHash,
  hammingDistance,
} from "@/lib/uploads";
import { runHiResBgRemovalBatch } from "@/lib/bgRemovalServer";
import { describeItem, logActivity } from "@/lib/activity";
import { backroomItemFilter, readBackroomParam } from "@/lib/backroom";

// Hamming distance threshold for "looks similar." 0 = identical,
// 64 = maximally different. ≤ 10 (about 16% bit difference) catches
// the same garment shot from a slightly different angle without
// flagging unrelated photos. Tuned by eye; easy to dial later.
const SIMILAR_PHASH_THRESHOLD = 10;
const SIMILAR_RESULT_LIMIT = 5;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category") || undefined;
  const fav = searchParams.get("fav") === "1";
  const search = searchParams.get("q")?.trim();
  const status = searchParams.get("status") || undefined;
  const includeBackroom = readBackroomParam(searchParams.get("backroom") ?? undefined);
  // ?backroom=only is the dedicated /wardrobe/backroom page — show
  // ONLY backroom items, ignoring the default-hide.
  const onlyBackroom = searchParams.get("backroom") === "only";

  const items = await prisma.item.findMany({
    where: {
      // Owner-scope guard: every closet view is per-profile. Without
      // this filter the endpoint returned every user's items to any
      // authenticated caller, which broke the documented "profiles
      // are separate" model.
      ownerId: userId,
      ...(onlyBackroom ? { isBackroom: true } : backroomItemFilter(includeBackroom)),
      ...(category ? { category } : {}),
      ...(fav ? { isFavorite: true } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { subType: { contains: search } },
              { brand: { contains: search } },
              { color: { contains: search } },
              { notes: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const original = form.get("image");
  const bgRemoved = form.get("imageBgRemoved");
  const labelImage = form.get("labelImage");
  const labelBgRemoved = form.get("labelImageBgRemoved");
  const category = String(form.get("category") || "");
  if (!original || !(original instanceof File) || !category) {
    return NextResponse.json({ error: "Missing image or category" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const subType = (form.get("subType") as string | null) || null;
  const color = (form.get("color") as string | null) || null;
  const brandText = (form.get("brand") as string | null) || null;
  const brandIdInput = (form.get("brandId") as string | null) || null;
  const size = (form.get("size") as string | null) || null;
  const fitDetails = (form.get("fitDetails") as string | null) || null;
  const fitNotes = (form.get("fitNotes") as string | null) || null;
  const notes = (form.get("notes") as string | null) || null;
  const seasons = listToCsv(form.getAll("seasons").map(String));
  const activities = listToCsv(form.getAll("activities").map(String));
  const isFavorite = form.get("isFavorite") === "1";
  const isBackroom = form.get("isBackroom") === "1";
  const statusVal = (form.get("status") as string | null) || "active";

  // Resolve brand: use brandId if it's the current user's, else upsert by key.
  let brandId: string | null = null;
  let brandFinal = brandText;
  if (brandIdInput) {
    const found = await prisma.brand.findFirst({ where: { id: brandIdInput, ownerId: userId } });
    if (found) {
      brandId = found.id;
      brandFinal = found.name;
    }
  }
  if (!brandId && brandText && brandText.trim()) {
    const key = brandKey(brandText);
    if (key) {
      const upserted = await prisma.brand.upsert({
        where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
        update: {},
        create: { ownerId: userId, name: brandText.trim(), nameKey: key },
      });
      brandId = upserted.id;
      brandFinal = upserted.name;
    }
  }

  const created = await prisma.item.create({
    data: {
      ownerId: userId,
      imagePath: "pending",
      category,
      subType,
      color,
      brand: brandFinal,
      brandId,
      size,
      fitDetails,
      fitNotes,
      seasons,
      activities,
      notes,
      isFavorite,
      isBackroom,
      status: statusVal,
    },
  });

  // Two-tier write for the main photo: a small display variant
  // (everything-but-zoom) plus the untouched original for the item
  // detail page's tap-to-zoom. Bg-removed stays single-variant —
  // utility render, not a user-precious memory.
  const { displayPath: imagePath, originalPath: imageOriginalPath } =
    await saveUploadWithOriginal(userId, created.id, original, "orig");
  let imageBgRemovedPath: string | null = null;
  if (bgRemoved && bgRemoved instanceof File && bgRemoved.size > 0) {
    imageBgRemovedPath = await saveUpload(userId, created.id, bgRemoved, "bg");
  }

  // Perceptual hash of the source upload. Computed off the raw bytes
  // so re-encoding into the display variant doesn't perturb the hash.
  // Used right below to surface possible duplicates back to the
  // client; null on sharp failures so the column is "no info" rather
  // than a misleading match.
  const phash = await computeDHash(Buffer.from(await original.arrayBuffer()));

  const updated = await prisma.item.update({
    where: { id: created.id },
    data: { imagePath, imageOriginalPath, imageBgRemovedPath, phash },
  });

  // Label photo (if any) goes to ItemPhoto kind="label" — items can
  // carry multiple labels (front of tag, care symbols, …). The first
  // one auto-tag reads is the oldest by createdAt. Bg-removed
  // companion is optional; the client runs bg removal in the same
  // pass it does for the main photo, so we accept the cutout here
  // and the strip can prefer it the same way it does for angles.
  if (labelImage && labelImage instanceof File && labelImage.size > 0) {
    const { displayPath: labelPath, originalPath: labelOriginal } =
      await saveUploadWithOriginal(userId, created.id, labelImage, "label", { bust: true });
    let labelBgPath: string | null = null;
    if (labelBgRemoved && labelBgRemoved instanceof File && labelBgRemoved.size > 0) {
      labelBgPath = await saveUpload(userId, created.id, labelBgRemoved, "label-bg");
    }
    await prisma.itemPhoto.create({
      data: {
        itemId: created.id,
        kind: "label",
        imagePath: labelPath,
        imageOriginalPath: labelOriginal,
        imageBgRemovedPath: labelBgPath,
      },
    });
  }

  await logActivity({
    userId,
    kind: "item.create",
    summary: `Added ${describeItem(updated)}`,
    targetType: "Item",
    targetId: updated.id,
  });

  // Hi-res cutout for the lightbox tap-to-zoom. Fire-and-forget — the
  // bg removal model takes 5-15 s on a full-res photo, which is way
  // too long to make the upload UX wait. The Node process keeps
  // running after the response flushes (we're long-running on
  // Proxmox, not serverless), so the worker finishes in the
  // background and the user sees the cutout swap into the lightbox
  // a few seconds after the closet refreshes.
  void runHiResBgRemovalBatch(prisma, userId, [updated.id]).catch((err) => {
    console.warn("hi-res bg removal kick-off failed:", err);
  });

  // "You might already own this" check. Pull every other phash for
  // this user (a 500-item closet is ~8 KB of strings, negligible),
  // then compute Hamming distance in app code — SQLite can't do
  // bitwise XOR on text columns natively. Anything within the
  // threshold rides back in the response so the client can prompt.
  const similar: Array<{
    id: string;
    distance: number;
    imagePath: string;
    imageBgRemovedPath: string | null;
    category: string;
    subType: string | null;
    color: string | null;
    brand: string | null;
  }> = [];
  if (phash) {
    const others = await prisma.item.findMany({
      where: {
        ownerId: userId,
        phash: { not: null },
        id: { not: updated.id },
        // Backroom items don't surface in the "you might already own
        // this" picker for non-Backroom uploads, and vice versa —
        // matching the closet's default-hide behaviour. (If the user
        // is uploading a Backroom item, we still match against other
        // Backroom items below.)
        isBackroom: updated.isBackroom,
      },
      select: {
        id: true,
        phash: true,
        imagePath: true,
        imageBgRemovedPath: true,
        category: true,
        subType: true,
        color: true,
        brand: true,
      },
    });
    for (const o of others) {
      if (!o.phash) continue;
      const dist = hammingDistance(phash, o.phash);
      if (dist <= SIMILAR_PHASH_THRESHOLD) {
        similar.push({
          id: o.id,
          distance: dist,
          imagePath: o.imagePath,
          imageBgRemovedPath: o.imageBgRemovedPath,
          category: o.category,
          subType: o.subType,
          color: o.color,
          brand: o.brand,
        });
      }
    }
    similar.sort((a, b) => a.distance - b.distance);
  }

  return NextResponse.json({
    item: updated,
    similar: similar.slice(0, SIMILAR_RESULT_LIMIT),
  });
}
