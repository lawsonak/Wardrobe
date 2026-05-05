import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  rotateOnDisk,
  saveBuffer,
  saveUploadWithOriginal,
  unlinkUpload,
} from "@/lib/uploads";

export const runtime = "nodejs";

const unlink = unlinkUpload;

function parseDegrees(value: unknown): 90 | 180 | 270 {
  if (value === 180) return 180;
  if (value === 270) return 270;
  return 90;
}

// PATCH /api/items/[id]/photos/[photoId] — rename label.
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

  const updated = await prisma.itemPhoto.update({ where: { id: photoId }, data });
  return NextResponse.json({ photo: updated });
}

// POST /api/items/[id]/photos/[photoId] — rotate the angle photo by
// 90 / 180 / 270°. Server-side via sharp; reads the existing original
// (or display variant for legacy angles), rotates, runs the rotated
// buffer back through the two-tier save so display + original stay
// in sync. Bg-removed variant is rotated alongside if present.
//
// Body shape: { degrees: 90 | 180 | 270 }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await params;

  const photo = await prisma.itemPhoto.findFirst({
    where: { id: photoId, itemId: id, item: { ownerId: userId } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const degrees = parseDegrees(Number(body.degrees));

  const sourcePath = photo.imageOriginalPath ?? photo.imagePath;
  const { buf, ext } = await rotateOnDisk(sourcePath, degrees);
  const mime =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const rotatedFile = new File([new Uint8Array(buf)], `rotated.${ext}`, { type: mime });
  const { displayPath: newImage, originalPath: newOriginal } = await saveUploadWithOriginal(
    userId,
    id,
    rotatedFile,
    "angle-orig",
    { bust: true },
  );

  let newBg: string | null = null;
  if (photo.imageBgRemovedPath) {
    const { buf: bgBuf, ext: bgExt } = await rotateOnDisk(photo.imageBgRemovedPath, degrees);
    const tag = Math.random().toString(36).slice(2, 8);
    newBg = await saveBuffer(userId, id, bgBuf, `angle-bg-${tag}`, bgExt);
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
