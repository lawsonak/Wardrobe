import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { UPLOAD_ROOT, computeDHash, unlinkUpload } from "@/lib/uploads";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// POST /api/items/[id]/photos/[photoId]/set-main
//
// Promote an ItemPhoto (angle / label / pending) to the item's main
// photo, demoting the previous main to a new ItemPhoto row.
//
// Body: { demoteToKind: "angle" | "label" }
//   - "angle": old main lands in the angles strip (most common).
//   - "label": old main lands in the labels strip — for the case
//     where the user accidentally saved a tag photo as the main.
//
// Side effects:
// - Recompute Item.phash from the new main's bytes so duplicate
//   detection on next upload reflects what the item actually shows
//   now.
// - Unlink the old Item.imageBgRemovedOriginalPath (the hi-res
//   lightbox cutout) — ItemPhoto has no equivalent, so it'd become an
//   orphan on disk otherwise.
// - Outfit try-on caches that reference this item invalidate on
//   their own — the cache hash includes the item's imagePath file
//   mtime, and the new main is a different file. No explicit sweep
//   needed.
const DEMOTE_KINDS = ["angle", "label"] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, photoId } = await params;

  const body = (await req.json().catch(() => ({}))) as { demoteToKind?: unknown };
  const demoteToKind = String(body.demoteToKind ?? "angle");
  if (!(DEMOTE_KINDS as readonly string[]).includes(demoteToKind)) {
    return NextResponse.json({ error: "Invalid demoteToKind" }, { status: 400 });
  }

  const item = await prisma.item.findFirst({
    where: { id, ownerId: userId },
    select: {
      id: true,
      imagePath: true,
      imageOriginalPath: true,
      imageBgRemovedPath: true,
      imageBgRemovedOriginalPath: true,
    },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const photo = await prisma.itemPhoto.findFirst({
    where: { id: photoId, itemId: id },
    select: {
      id: true,
      kind: true,
      imagePath: true,
      imageOriginalPath: true,
      imageBgRemovedPath: true,
    },
  });
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  // Recompute the perceptual hash from the new main's bytes — prefer
  // the higher-fidelity original when we have one. If sharp can't
  // read the file (e.g. legacy entry pointing at a missing file) the
  // helper returns null, which is fine — the column accepts null.
  const phashSource = photo.imageOriginalPath ?? photo.imagePath;
  let phash: string | null = null;
  try {
    const buf = await fs.readFile(path.join(UPLOAD_ROOT, phashSource));
    phash = await computeDHash(buf);
  } catch (err) {
    console.warn("set-main: phash recompute failed (file unreadable)", err);
  }

  // Next free position within the demotion kind so the old main lands
  // at the end of the strip. max(position)+1 rather than count() —
  // counting collides after deletions or rapid successive promotions
  // (two rows at the same position; createdAt tie-break hides it but
  // the semantics drift).
  const tail = await prisma.itemPhoto.aggregate({
    where: { itemId: id, kind: demoteToKind },
    _max: { position: true },
  });
  const tailPosition = (tail._max.position ?? -1) + 1;

  await prisma.$transaction([
    // Move the ItemPhoto's paths up onto the item.
    prisma.item.update({
      where: { id },
      data: {
        imagePath: photo.imagePath,
        imageOriginalPath: photo.imageOriginalPath,
        imageBgRemovedPath: photo.imageBgRemovedPath,
        // ItemPhoto has no hi-res cutout; the lightbox tap-to-zoom on
        // the new main falls back to the display cutout, which is
        // fine for everyday use.
        imageBgRemovedOriginalPath: null,
        phash,
      },
    }),
    // Old main becomes a new ItemPhoto row.
    prisma.itemPhoto.create({
      data: {
        itemId: id,
        kind: demoteToKind,
        imagePath: item.imagePath,
        imageOriginalPath: item.imageOriginalPath,
        imageBgRemovedPath: item.imageBgRemovedPath,
        position: tailPosition,
      },
    }),
    // The promoted row's old position is now stale — delete it. The
    // files themselves stay on disk; they're still referenced by the
    // Item.imagePath / imageOriginalPath / imageBgRemovedPath columns
    // we just set above.
    prisma.itemPhoto.delete({ where: { id: photoId } }),
  ]);

  // Hi-res bg-removed cutout was only on the old main — orphan it now
  // so the storage page doesn't accumulate dead lightbox files.
  await unlinkUpload(item.imageBgRemovedOriginalPath);

  await logActivity({
    userId,
    kind: "item.photo.set-main",
    summary: `Promoted ${photo.kind} photo to main`,
    targetType: "Item",
    targetId: id,
    meta: { demotedTo: demoteToKind, promotedFromKind: photo.kind },
  });

  return NextResponse.json({ ok: true });
}
