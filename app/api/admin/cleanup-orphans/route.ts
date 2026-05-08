import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listUserFiles, UPLOAD_ROOT } from "@/lib/uploads";

export const runtime = "nodejs";

// Deletes files that are present under data/uploads/<userId>/ but not
// referenced by any Item, WishlistItem, ItemPhoto, or Outfit (try-on)
// row. We re-do the join here rather than trust client input so a stale
// page can't trick us into deleting referenced files.
export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // listUserFiles walks subdirectories (wishlist/, etc.) so files
  // under nested folders are enumerated. Previously this was a flat
  // readdir that skipped wishlist/ entirely — orphan wishlist photos
  // would never get cleaned up.
  const filesOnDisk = await listUserFiles(userId);
  if (filesOnDisk.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

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

  // The personal-mannequin files live by fixed name (mannequin.png,
  // mannequin.json, mannequin-source.<ext>) — there's no DB row to
  // join against, so whitelist the prefix instead of marking each one.
  // Today's-outfit files follow the same pattern: a JSON pick + a
  // dated tryon PNG that's overwritten when the user re-picks.
  const mannequinFile = (name: string) =>
    name === "mannequin.png" ||
    name === "mannequin.json" ||
    name === "todays-outfit.json" ||
    name === "todays-suggestion.json" ||
    name.startsWith("mannequin-source.") ||
    name.startsWith("todays-outfit-tryon-");

  let deleted = 0;
  let bytes = 0;
  for (const f of filesOnDisk) {
    // Match the basename for the whitelist so dated mannequin /
    // today's-outfit assets in the user root still survive.
    const basename = path.posix.basename(f.rel);
    if (mannequinFile(basename)) continue;
    if (referenced.has(f.rel)) continue;
    bytes += f.size;
    try {
      await fs.unlink(path.join(UPLOAD_ROOT, f.rel));
      deleted++;
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({ deleted, bytes });
}
