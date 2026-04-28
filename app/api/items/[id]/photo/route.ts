import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

async function saveUpload(userId: string, itemId: string, file: File, suffix: string) {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  // Append a tiny random tag so a replacement gets a fresh path (browsers
  // happily cache the old URL otherwise).
  const tag = Math.random().toString(36).slice(2, 8);
  const filename = `${itemId}-${suffix}-${tag}.${ext}`;
  const fullPath = path.join(userDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

async function unlink(p: string | null | undefined) {
  if (!p) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, p));
  } catch {
    /* ignore */
  }
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
    const newImage = await saveUpload(userId, id, image, "orig");
    let newBg: string | null = null;
    if (bg && bg instanceof File && bg.size > 0) {
      newBg = await saveUpload(userId, id, bg, "bg");
    }
    const oldImage = item.imagePath;
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: { imagePath: newImage, imageBgRemovedPath: newBg },
    });
    await unlink(oldImage);
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
