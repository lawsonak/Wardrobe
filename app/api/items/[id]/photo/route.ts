import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  saveUpload as save,
  saveBuffer,
  saveUploadWithOriginal as saveWithOrig,
  rotateOnDisk,
  unlinkUpload as unlink,
} from "@/lib/uploads";

export const runtime = "nodejs";

// Photo replacements append a random tag so the new URL doesn't collide
// with the browser-cached old one.
const saveUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  save(userId, itemId, file, suffix, { bust: true });
const saveMainUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  saveWithOrig(userId, itemId, file, suffix, { bust: true });

// Pull a 90 / 180 / 270 from a request body, defaulting to 90 if the
// caller fat-fingered something. Anything outside the valid set falls
// back so a bad client can't inject a free-form rotation we'd happily
// run through sharp.
function parseDegrees(value: unknown): 90 | 180 | 270 {
  if (value === 180) return 180;
  if (value === 270) return 270;
  return 90;
}

// Replace photos on an existing item.
//   - `image` (required for `which=main`): new main photo
//   - `imageBgRemoved` (optional, with `which=main`): pre-removed companion
//   - `label` (with `which=label`): new label/tag photo
// `which=label-clear` removes the label photo entirely.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const item = await prisma.item.findFirst({ where: { id, ownerId: userId } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const which = String(form.get("which") || "");

  if (which === "main") {
    const image = form.get("image");
    const bg = form.get("imageBgRemoved");
    if (!image || !(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }
    const { displayPath: newImage, originalPath: newOriginal } = await saveMainUpload(
      userId,
      id,
      image,
      "orig",
    );
    let newBg: string | null = null;
    if (bg && bg instanceof File && bg.size > 0) {
      newBg = await saveUpload(userId, id, bg, "bg");
    }
    const oldImage = item.imagePath;
    const oldOriginal = item.imageOriginalPath;
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: {
        imagePath: newImage,
        imageOriginalPath: newOriginal,
        imageBgRemovedPath: newBg,
      },
    });
    await unlink(oldImage);
    await unlink(oldOriginal);
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  // Just replace the bg-removed variant — keeps the original photo.
  // Used by the "Re-run background removal" button on item detail.
  if (which === "bg") {
    const bg = form.get("imageBgRemoved");
    if (!bg || !(bg instanceof File) || bg.size === 0) {
      return NextResponse.json({ error: "Missing imageBgRemoved" }, { status: 400 });
    }
    const newBg = await saveUpload(userId, id, bg, "bg");
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: { imageBgRemovedPath: newBg },
    });
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  // Drop the bg-removed variant entirely (revert to original photo).
  if (which === "bg-clear") {
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: { imageBgRemovedPath: null },
    });
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  if (which === "label") {
    const label = form.get("label");
    if (!label || !(label instanceof File) || label.size === 0) {
      return NextResponse.json({ error: "Missing label image" }, { status: 400 });
    }
    const newPath = await saveUpload(userId, id, label, "label");
    const oldPath = item.labelImagePath;
    const updated = await prisma.item.update({
      where: { id },
      data: { labelImagePath: newPath },
    });
    await unlink(oldPath);
    return NextResponse.json({ item: updated });
  }

  if (which === "label-clear") {
    const oldPath = item.labelImagePath;
    const updated = await prisma.item.update({
      where: { id },
      data: { labelImagePath: null },
    });
    await unlink(oldPath);
    return NextResponse.json({ item: updated });
  }

  // Rotate the main hero photo by 90 / 180 / 270° on the server.
  // Reads the existing original (or display variant for legacy items
  // with no original), rotates with sharp, runs the rotated buffer
  // back through the two-tier save so the new display + original both
  // come out the right way up. Bg-removed variant is rotated alongside
  // so the closet card stays in sync.
  if (which === "main-rotate") {
    const degrees = parseDegrees(Number(form.get("degrees")));
    const sourcePath = item.imageOriginalPath ?? item.imagePath;
    const { buf, ext } = await rotateOnDisk(sourcePath, degrees);
    const mime =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const rotatedFile = new File([new Uint8Array(buf)], `rotated.${ext}`, { type: mime });
    const { displayPath: newImage, originalPath: newOriginal } = await saveMainUpload(
      userId,
      id,
      rotatedFile,
      "orig",
    );

    let newBg: string | null = null;
    if (item.imageBgRemovedPath) {
      const { buf: bgBuf, ext: bgExt } = await rotateOnDisk(item.imageBgRemovedPath, degrees);
      const tag = Math.random().toString(36).slice(2, 8);
      newBg = await saveBuffer(userId, id, bgBuf, `bg-${tag}`, bgExt);
    }

    const oldImage = item.imagePath;
    const oldOriginal = item.imageOriginalPath;
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: {
        imagePath: newImage,
        imageOriginalPath: newOriginal,
        imageBgRemovedPath: newBg,
      },
    });
    await unlink(oldImage);
    await unlink(oldOriginal);
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  // Rotate the label / tag photo. Single-variant — labels don't have
  // an "original" tier — so just rewrite in place under a new tag.
  if (which === "label-rotate") {
    if (!item.labelImagePath) {
      return NextResponse.json({ error: "No label photo to rotate" }, { status: 400 });
    }
    const degrees = parseDegrees(Number(form.get("degrees")));
    const { buf, ext } = await rotateOnDisk(item.labelImagePath, degrees);
    const tag = Math.random().toString(36).slice(2, 8);
    const newPath = await saveBuffer(userId, id, buf, `label-${tag}`, ext);
    const oldPath = item.labelImagePath;
    const updated = await prisma.item.update({
      where: { id },
      data: { labelImagePath: newPath },
    });
    await unlink(oldPath);
    return NextResponse.json({ item: updated });
  }

  return NextResponse.json({ error: "Unknown which" }, { status: 400 });
}
