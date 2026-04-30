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
  const tag = Math.random().toString(36).slice(2, 8);
  const filename = `${itemId}-angle-${tag}-${suffix}.${ext}`;
  const fullPath = path.join(userDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

// POST /api/items/[id]/photos
//
// Multipart upload of an additional photo angle for an existing
// item. Accepts:
//   - `image` (required): the original photo
//   - `imageBgRemoved` (optional): pre-removed cutout
//   - `label` (optional): free-form caption ("back", "side", etc.)
//
// Returns the created ItemPhoto row.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, _count: { select: { photos: true } } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item._count.photos >= 12) {
    return NextResponse.json({ error: "Up to 12 angles per item." }, { status: 400 });
  }

  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  const imagePath = await saveUpload(userId, id, image, "orig");

  let imageBgRemovedPath: string | null = null;
  const bg = form.get("imageBgRemoved");
  if (bg && bg instanceof File && bg.size > 0) {
    imageBgRemovedPath = await saveUpload(userId, id, bg, "bg");
  }

  const label = form.get("label");
  const labelText =
    typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : null;

  const photo = await prisma.itemPhoto.create({
    data: {
      itemId: id,
      imagePath,
      imageBgRemovedPath,
      label: labelText,
      position: item._count.photos,
    },
  });

  return NextResponse.json({ photo });
}
