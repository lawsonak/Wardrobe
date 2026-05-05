import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

// Walks data/uploads/<userId>/ for the current user, then cross-references
// the file list against image paths referenced by Items / Wishlist.
// Returns { totalBytes, totalFiles, orphans: string[], missing: string[] }.
//
// `orphans` are files on disk that aren't referenced by any DB row (safe
// to delete). `missing` are DB references that don't have a file on disk
// (broken images — usually means a hand-deleted file).
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userDir = path.join(UPLOAD_ROOT, userId);
  let entries: string[] = [];
  let totalBytes = 0;
  try {
    entries = await fs.readdir(userDir);
  } catch {
    entries = [];
  }
  const filesOnDisk = new Set<string>();
  for (const e of entries) {
    try {
      const stat = await fs.stat(path.join(userDir, e));
      if (stat.isFile()) {
        filesOnDisk.add(path.posix.join(userId, e));
        totalBytes += stat.size;
      }
    } catch {
      /* ignore */
    }
  }

  const [items, wishlist, photos, outfits] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId },
      select: {
        imagePath: true,
        imageOriginalPath: true,
        imageBgRemovedPath: true,
        labelImagePath: true,
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
    if (it.labelImagePath) referenced.add(it.labelImagePath);
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
