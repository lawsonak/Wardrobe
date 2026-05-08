import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listUserFiles } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Walks data/uploads/<userId>/ recursively for the current user, then
// cross-references the file list against image paths referenced by
// Items / Wishlist / ItemPhoto / Outfit.
// Returns { totalBytes, totalFiles, orphans: string[], missing: string[] }.
//
// `orphans` are files on disk that aren't referenced by any DB row (safe
// to delete). `missing` are DB references that don't have a file on disk
// (broken images — usually means a hand-deleted file).
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Recursive — picks up wishlist/ subdir contents which the previous
  // flat readdir skipped, so the storage usage report under-counted
  // and orphan listings missed wishlist photos.
  const fileEntries = await listUserFiles(userId);
  const filesOnDisk = new Set<string>(fileEntries.map((f) => f.rel));
  const totalBytes = fileEntries.reduce((sum, f) => sum + f.size, 0);

  const [items, wishlist, photos, outfits] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId },
      select: {
        imagePath: true,
        imageOriginalPath: true,
        imageBgRemovedPath: true,
        imageBgRemovedOriginalPath: true,
      },
    }),
    prisma.wishlistItem.findMany({
      where: { ownerId: userId },
      select: { imagePath: true },
    }),
    prisma.itemPhoto.findMany({
      where: { item: { ownerId: userId } },
      select: {
        imagePath: true,
        imageOriginalPath: true,
        imageBgRemovedPath: true,
      },
    }),
    prisma.outfit.findMany({
      where: { ownerId: userId },
      select: { tryOnImagePath: true },
    }),
  ]);

  const referenced = new Set<string>();
  for (const it of items) {
    if (it.imagePath) referenced.add(it.imagePath);
    if (it.imageOriginalPath) referenced.add(it.imageOriginalPath);
    if (it.imageBgRemovedPath) referenced.add(it.imageBgRemovedPath);
    if (it.imageBgRemovedOriginalPath) referenced.add(it.imageBgRemovedOriginalPath);
  }
  for (const w of wishlist) if (w.imagePath) referenced.add(w.imagePath);
  for (const p of photos) {
    if (p.imagePath) referenced.add(p.imagePath);
    if (p.imageOriginalPath) referenced.add(p.imageOriginalPath);
    if (p.imageBgRemovedPath) referenced.add(p.imageBgRemovedPath);
  }
  for (const o of outfits) if (o.tryOnImagePath) referenced.add(o.tryOnImagePath);

  const orphans = [...filesOnDisk].filter((f) => !referenced.has(f));
  const missing = [...referenced].filter((f) => !filesOnDisk.has(f));

  return NextResponse.json({
    totalFiles: filesOnDisk.size,
    totalBytes,
    orphans,
    missing,
  });
}
