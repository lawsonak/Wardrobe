import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  rotateOnDisk,
  saveBuffer,
  saveUpload as save,
  saveUploadWithOriginal,
  unlinkUpload,
} from "@/lib/uploads";

export const runtime = "nodejs";

const unlink = unlinkUpload;
const saveUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  save(userId, itemId, file, suffix, { bust: true });

function parseDegrees(value: unknown): 90 | 180 | 270 {
  if (value === 180) return 180;
  if (value === 270) return 270;
  return 90;
}

// PATCH /api/items/[id]/photos/[photoId] — rename label, or promote
// a pending photo to "label" / "angle". The merge endpoint folds a
// source item's main photo onto the target as kind="pending"; the
// user resolves the pending state from the item-edit page by
// PATCHing kind here.
const PATCHABLE_KINDS = ["angle", "label", "pending"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await params;

  // Confirm ownership via the parent item.
  const photo = await prisma.itemPhoto.findFirst({
    where: { id: photoId, itemId: id, item: { ownerId: userId } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.label === null) data.label = null;
  else if (typeof body.label === "string") data.label = body.label.trim().slice(0, 60) || null;
  if (typeof body.kind === "string") {
    if (!(PATCHABLE_KINDS as readonly string[]).includes(body.kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    data.kind = body.kind;
  }

  const updated = await prisma.itemPhoto.update({ where: { id: photoId }, data });
  return NextResponse.json({ photo: updated });
}

// POST /api/items/[id]/photos/[photoId] — two shapes, picked by
// content-type:
//   - JSON  { degrees }                  → server-side rotation
//   - multipart { which:"bg", imageBgRemoved } → save / replace the
//     bg-removed cutout on this angle / label without touching the
//     source photo. Mirrors `which=bg` on /api/items/[id]/photo and
//     is what the admin BgCleanup walker calls when extending bg
//     removal to ItemPhoto rows.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await params;

  const photo = await prisma.itemPhoto.findFirst({
    where: { id: photoId, itemId: id, item: { ownerId: userId } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const contentType = req.headers.get("content-type") || "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const which = String(form.get("which") || "bg");
    if (which !== "bg") {
      return NextResponse.json({ error: "Unknown which" }, { status: 400 });
    }
    const bg = form.get("imageBgRemoved");
    if (!bg || !(bg instanceof File) || bg.size === 0) {
      return NextResponse.json({ error: "Missing imageBgRemoved" }, { status: 400 });
    }
    const suffix = photo.kind === "label" ? "label-bg" : "angle-bg";
    const newBg = await saveUpload(userId, id, bg, suffix);
    const oldBg = photo.imageBgRemovedPath;
    const updated = await prisma.itemPhoto.update({
      where: { id: photoId },
      data: { imageBgRemovedPath: newBg },
    });
    await unlink(oldBg);
    return NextResponse.json({ photo: updated });
  }

  const body = await req.json().catch(() => ({}));
  const degrees = parseDegrees(Number(body.degrees));

  const sourcePath = photo.imageOriginalPath ?? photo.imagePath;
  const { buf, ext } = await rotateOnDisk(sourcePath, degrees);
  const mime =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const rotatedFile = new File([new Uint8Array(buf)], `rotated.${ext}`, { type: mime });
  // Filename suffix follows the row's kind so `label-orig` /
  // `label-bg` tag-photo files don't get written as `angle-orig`
  // (which is what the previous hard-coded value did, leaving the
  // on-disk filenames inconsistent with the DB kind).
  const origSuffix = photo.kind === "label" ? "label-orig" : "angle-orig";
  const bgSuffix = photo.kind === "label" ? "label-bg" : "angle-bg";
  const { displayPath: newImage, originalPath: newOriginal } = await saveUploadWithOriginal(
    userId,
    id,
    rotatedFile,
    origSuffix,
    { bust: true },
  );

  let newBg: string | null = null;
  if (photo.imageBgRemovedPath) {
    const { buf: bgBuf, ext: bgExt } = await rotateOnDisk(photo.imageBgRemovedPath, degrees);
    const tag = Math.random().toString(36).slice(2, 8);
    newBg = await saveBuffer(userId, id, bgBuf, `${bgSuffix}-${tag}`, bgExt);
  }

  const oldImage = photo.imagePath;
  const oldOriginal = photo.imageOriginalPath;
  const oldBg = photo.imageBgRemovedPath;
  const updated = await prisma.itemPhoto.update({
    where: { id: photoId },
    data: {
      imagePath: newImage,
      imageOriginalPath: newOriginal,
      imageBgRemovedPath: newBg,
    },
  });
  await unlink(oldImage);
  await unlink(oldOriginal);
  await unlink(oldBg);

  return NextResponse.json({ photo: updated });
}

// DELETE /api/items/[id]/photos/[photoId] — remove an angle.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await params;

  const photo = await prisma.itemPhoto.findFirst({
    where: { id: photoId, itemId: id, item: { ownerId: userId } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.itemPhoto.delete({ where: { id: photoId } });
  await unlink(photo.imagePath);
  await unlink(photo.imageOriginalPath);
  await unlink(photo.imageBgRemovedPath);

  return NextResponse.json({ ok: true });
}
