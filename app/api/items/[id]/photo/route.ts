import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  saveUpload as save,
  saveUploadWithOriginal as saveWithOrig,
  unlinkUpload as unlink,
} from "@/lib/uploads";

export const runtime = "nodejs";

// Photo replacements append a random tag so the new URL doesn't collide
// with the browser-cached old one.
const saveUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  save(userId, itemId, file, suffix, { bust: true });
const saveMainUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  saveWithOrig(userId, itemId, file, suffix, { bust: true });

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

  return NextResponse.json({ error: "Unknown which" }, { status: 400 });
}
