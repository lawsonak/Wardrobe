import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveUpload as save, saveUploadWithOriginal as saveWithOrig } from "@/lib/uploads";

export const runtime = "nodejs";

// Random-tagged filenames so we don't collide with the main photo's
// `<itemId>-orig.jpg` pattern when the user adds a back / side / label
// shot for the same item.
const saveUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  save(userId, itemId, file, suffix, { bust: true });
const saveTwoTier = (userId: string, itemId: string, file: File, suffix: string) =>
  saveWithOrig(userId, itemId, file, suffix, { bust: true });

const PHOTO_KINDS = ["angle", "label"] as const;
type PhotoKind = (typeof PHOTO_KINDS)[number];

// 12 of EACH kind (angles + labels independent) so a busy item with
// front / back / sleeve angles doesn't eat into the label budget.
const PER_KIND_LIMIT = 12;

// POST /api/items/[id]/photos
//
// Multipart upload of an additional photo for an existing item.
// Accepts:
//   - `image` (required): the photo
//   - `imageBgRemoved` (optional, angle only): pre-removed cutout
//   - `label` (optional): free-form caption ("back", "size", etc.)
//   - `kind` (optional, default "angle"): "angle" | "label". Angles
//     are extra full-body shots that show up in the read-only
//     carousel. Labels are tag / care-symbol close-ups that get
//     their own strip; AI auto-tag reads the oldest one by createdAt.
//
// Returns the created ItemPhoto row.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { id, ownerId: userId },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  const rawKind = String(form.get("kind") || "angle");
  const kind: PhotoKind = (PHOTO_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as PhotoKind)
    : "angle";

  // Per-kind budget so labels don't crowd out angles or vice-versa.
  const existingOfKind = await prisma.itemPhoto.count({
    where: { itemId: id, kind },
  });
  if (existingOfKind >= PER_KIND_LIMIT) {
    return NextResponse.json(
      { error: `Up to ${PER_KIND_LIMIT} ${kind === "label" ? "labels" : "angles"} per item.` },
      { status: 400 },
    );
  }

  const suffix = kind === "label" ? "label" : "angle-orig";
  const { displayPath: imagePath, originalPath: imageOriginalPath } = await saveTwoTier(
    userId,
    id,
    image,
    suffix,
  );

  // Background-removed companion. Labels were originally skipped
  // here ("flat tag photos, no figure to cut out") but a bg-removed
  // tag photo actually reads way better in the strip — model isolates
  // the tag itself, drops the dim closet floor / hand holding it.
  // Both kinds are eligible now; the client decides whether to send
  // a pre-removed variant.
  let imageBgRemovedPath: string | null = null;
  const bg = form.get("imageBgRemoved");
  if (bg && bg instanceof File && bg.size > 0) {
    const bgSuffix = kind === "label" ? "label-bg" : "angle-bg";
    imageBgRemovedPath = await saveUpload(userId, id, bg, bgSuffix);
  }

  const label = form.get("label");
  const labelText =
    typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : null;

  const photo = await prisma.itemPhoto.create({
    data: {
      itemId: id,
      kind,
      imagePath,
      imageOriginalPath,
      imageBgRemovedPath,
      label: labelText,
      position: existingOfKind,
    },
  });

  return NextResponse.json({ photo });
}
