import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { unlinkUpload } from "@/lib/uploads";
import { describeItem, logActivity } from "@/lib/activity";

export const runtime = "nodejs";

const PHOTO_KINDS = ["angle", "label"] as const;
type PhotoKind = (typeof PHOTO_KINDS)[number];

const MAX_SOURCES_PER_CALL = 25;

// POST /api/items/[id]/merge
//
// Fold one or more "source" items into this target. Use case: the
// user dumped a stack of clothing-tag photos through bulk upload and
// each one landed as a standalone item with status="needs_review".
// Merging consolidates them onto the actual garments — the source's
// main photo becomes a new ItemPhoto on the target (kind=label by
// default), any extra photos already on the source are moved across
// preserving their kind, and the source row is deleted.
//
// Body: { sourceIds: string[], asKind?: "angle" | "label" }
//   - sourceIds: items to merge INTO `id`. Owner-checked.
//   - asKind: kind to assign to each source's main-photo row on the
//     target. Defaults to "label" since that's the dominant flow.
//     Photos that already lived on the source as ItemPhoto rows keep
//     their original kind.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: targetId } = await params;
  const body = await req.json().catch(() => ({}));
  const sourceIds: string[] = Array.isArray(body?.sourceIds)
    ? Array.from(
        new Set(
          (body.sourceIds as unknown[])
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .filter((x) => x !== targetId),
        ),
      )
    : [];
  const rawKind = String(body?.asKind ?? "label");
  const asKind: PhotoKind = (PHOTO_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as PhotoKind)
    : "label";

  if (sourceIds.length === 0) {
    return NextResponse.json({ error: "No source items provided" }, { status: 400 });
  }
  if (sourceIds.length > MAX_SOURCES_PER_CALL) {
    return NextResponse.json(
      { error: `Merge up to ${MAX_SOURCES_PER_CALL} items at a time.` },
      { status: 400 },
    );
  }

  const target = await prisma.item.findFirst({
    where: { id: targetId, ownerId: userId },
    select: { id: true, category: true, subType: true, color: true, brand: true },
  });
  if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

  const sources = await prisma.item.findMany({
    where: { id: { in: sourceIds }, ownerId: userId },
  });
  if (sources.length !== sourceIds.length) {
    return NextResponse.json(
      { error: "Some source items weren't found in your closet." },
      { status: 404 },
    );
  }

  let mergedPhotos = 0;

  // Unlink-after-success: the merge transfers `imagePath`,
  // `imageOriginalPath`, and `imageBgRemovedPath` off each source
  // Item by reference, so we MUST NOT touch those files. The full-res
  // cutout (`imageBgRemovedOriginalPath`) doesn't have a home on
  // ItemPhoto and would otherwise become an orphan, so we collect
  // those paths and unlink them at the end.
  const filesToUnlink: string[] = [];

  for (const src of sources) {
    // Hand off any existing ItemPhoto rows on the source to the target.
    // They keep their kind / position / paths — angle stays angle, label
    // stays label. New positions on the target may collide with what's
    // already there, but the carousel sorts by `[position asc, createdAt
    // asc]` so duplicates land in upload order and look fine.
    const moved = await prisma.itemPhoto.updateMany({
      where: { itemId: src.id },
      data: { itemId: targetId },
    });
    mergedPhotos += moved.count;

    // The source's MAIN photo isn't an ItemPhoto row — it lives
    // directly on Item. Materialize it as a new ItemPhoto on the
    // target with the requested kind. Position goes after whatever's
    // already there in that kind.
    const existingOfKind = await prisma.itemPhoto.count({
      where: { itemId: targetId, kind: asKind },
    });
    await prisma.itemPhoto.create({
      data: {
        itemId: targetId,
        kind: asKind,
        imagePath: src.imagePath,
        imageOriginalPath: src.imageOriginalPath,
        imageBgRemovedPath: src.imageBgRemovedPath,
        position: existingOfKind,
      },
    });
    mergedPhotos += 1;

    // Drop join rows that hold a foreign key to the source. OutfitItem
    // has no cascade in the schema, so the explicit deleteMany is
    // required to avoid an FK violation on the Item.delete below.
    // CollectionItem does cascade but we delete it explicitly anyway —
    // belt and braces, and means a tag-only "needs_review" item that
    // somehow ended up in a packing list doesn't drag Outfit-builder
    // entries along.
    await prisma.outfitItem.deleteMany({ where: { itemId: src.id } });
    await prisma.collectionItem.deleteMany({ where: { itemId: src.id } });

    // Delete the source row directly. The standard DELETE handler at
    // /api/items/[id] would unlink files on disk — those files now
    // belong to the target's new ItemPhoto rows, so we bypass it and
    // call prisma.delete ourselves. ItemPhoto has ON DELETE CASCADE
    // but every row has been moved off this item by now, so nothing
    // cascades.
    await prisma.item.delete({ where: { id: src.id } });

    // The full-resolution cutout (used by lightbox tap-to-zoom) has
    // no column on ItemPhoto, so it can't ride along — clean it up.
    if (src.imageBgRemovedOriginalPath) {
      filesToUnlink.push(src.imageBgRemovedOriginalPath);
    }
  }

  for (const p of filesToUnlink) {
    await unlinkUpload(p);
  }

  await logActivity({
    userId,
    kind: "item.merge",
    summary: `Merged ${sources.length} item${sources.length === 1 ? "" : "s"} into ${describeItem(target)}`,
    targetType: "Item",
    targetId,
  });

  return NextResponse.json({ ok: true, mergedPhotos, mergedSources: sources.length });
}
