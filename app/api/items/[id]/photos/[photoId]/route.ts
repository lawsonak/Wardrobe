import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

async function unlink(p: string | null | undefined) {
  if (!p) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, p));
  } catch {
    /* ignore */
  }
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
  await unlink(photo.imageBgRemovedPath);

  return NextResponse.json({ ok: true });
}
