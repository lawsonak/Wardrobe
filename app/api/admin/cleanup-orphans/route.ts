import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

// Deletes files that are present under data/uploads/<userId>/ but not
// referenced by any Item, WishlistItem, ItemPhoto, or Outfit (try-on)
// row. We re-do the join here rather than trust client input so a stale
// page can't trick us into deleting referenced files.
export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userDir = path.join(UPLOAD_ROOT, userId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(userDir);
  } catch {
    return NextResponse.json({ deleted: 0 });
  }

  const [items, wishlist, photos, outfits] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId },
      select: { imagePath: true, imageBgRemovedPath: true, labelImagePath: true },
    }),
    prisma.wishlistItem.findMany({
      where: { ownerId: userId },
      select: { imagePath: true },
    }),
    prisma.itemPhoto.findMany({
      where: { item: { ownerId: userId } },
      select: { imagePath: true, imageBgRemovedPath: true },
    }),
    prisma.outfit.findMany({
      where: { ownerId: userId },
      select: { tryOnImagePath: true },
    }),
  ]);
  const referenced = new Set<string>();
  for (const it of items) {
    if (it.imagePath) referenced.add(it.imagePath);
    if (it.imageBgRemovedPath) referenced.add(it.imageBgRemovedPath);
    if (it.labelImagePath) referenced.add(it.labelImagePath);
  }
  for (const w of wishlist) if (w.imagePath) referenced.add(w.imagePath);
  for (const p of photos) {
    if (p.imagePath) referenced.add(p.imagePath);
    if (p.imageBgRemovedPath) referenced.add(p.imageBgRemovedPath);
  }
  for (const o of outfits) if (o.tryOnImagePath) referenced.add(o.tryOnImagePath);

  // The personal-mannequin files live by fixed name (mannequin.png,
  // mannequin.json, mannequin-source.<ext>) — there's no DB row to
  // join against, so whitelist the prefix instead of marking each one.
  const mannequinFile = (name: string) =>
    name === "mannequin.png" ||
    name === "mannequin.json" ||
    name === "todays-outfit.json" ||
    name.startsWith("mannequin-source.");

  let deleted = 0;
  let bytes = 0;
  for (const e of entries) {
    if (mannequinFile(e)) continue;
    const rel = path.posix.join(userId, e);
    if (referenced.has(rel)) continue;
    const full = path.join(userDir, e);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      bytes += stat.size;
      await fs.unlink(full);
      deleted++;
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({ deleted, bytes });
}
