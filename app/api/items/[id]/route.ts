import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, listToCsv } from "@/lib/constants";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.isFavorite === "boolean") data.isFavorite = body.isFavorite;
  if (typeof body.subType === "string") data.subType = body.subType || null;
  if (typeof body.color === "string") data.color = body.color || null;
  if (typeof body.brand === "string") data.brand = body.brand || null;
  if (typeof body.size === "string") data.size = body.size || null;
  if (typeof body.notes === "string") data.notes = body.notes || null;
  if (Array.isArray(body.seasons)) data.seasons = listToCsv(body.seasons.map(String));
  if (Array.isArray(body.activities)) data.activities = listToCsv(body.activities.map(String));
  if (typeof body.category === "string") {
    if (!CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = body.category;
  }

  const updated = await prisma.item.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Remove from any saved outfits
  await prisma.outfitItem.deleteMany({ where: { itemId: id } });
  await prisma.item.delete({ where: { id } });

  // Best-effort: delete files
  for (const p of [item.imagePath, item.imageBgRemovedPath].filter(Boolean) as string[]) {
    try {
      await fs.unlink(path.join(UPLOAD_ROOT, p));
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({ ok: true });
}
