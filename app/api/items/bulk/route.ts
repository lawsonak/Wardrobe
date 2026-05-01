import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/constants";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

async function saveUpload(userId: string, itemId: string, file: File, suffix: string) {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const filename = `${itemId}-${suffix}.${ext}`;
  const fullPath = path.join(userDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

// Multipart POST. Accepts multiple `images` parts plus a single
// `category` and optional `status` (defaults to "needs_review"). Saves
// each photo as its own Item in one round trip — no background removal,
// no AI tagging. Returns the created item ids so the client can keep
// processing them client-side (bg removal, auto-tag) on its own time.
//
// This is what you call from the bulk-upload page so the user can close
// the tab right after the upload completes; bg removal becomes a
// separate, resumable pass.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const rawCategory = String(form.get("category") || "");
  // "__auto__" means the user wants AI to assign a category. We need a
  // non-null category at insert time, so store a placeholder ("Tops")
  // and force needs_review status — AI tagging will overwrite both.
  const isAuto = rawCategory === "__auto__";
  const category = isAuto ? "Tops" : rawCategory;
  if (!isAuto && (!category || !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))) {
    return NextResponse.json({ error: "Missing or invalid category" }, { status: 400 });
  }
  const statusVal = isAuto
    ? "needs_review"
    : (form.get("status") as string | null) || "needs_review";

  const files = form.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "No images attached" }, { status: 400 });
  }
  if (files.length > 50) {
    return NextResponse.json({ error: "Max 50 photos per request" }, { status: 400 });
  }

  const created: Array<{ id: string; imagePath: string }> = [];
  for (const file of files) {
    const placeholder = await prisma.item.create({
      data: {
        ownerId: userId,
        imagePath: "pending",
        category,
        status: statusVal,
      },
    });
    const imagePath = await saveUpload(userId, placeholder.id, file, "orig");
    const updated = await prisma.item.update({
      where: { id: placeholder.id },
      data: { imagePath },
    });
    created.push({ id: updated.id, imagePath: updated.imagePath });
  }

  return NextResponse.json({ created, count: created.length }, { status: 201 });
}
