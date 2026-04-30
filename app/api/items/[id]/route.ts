import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, ITEM_STATUSES, listToCsv } from "@/lib/constants";
import { brandKey } from "@/lib/brand";

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
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.isFavorite === "boolean") data.isFavorite = body.isFavorite;
  if (typeof body.subType === "string") data.subType = body.subType || null;
  if (typeof body.color === "string") data.color = body.color || null;
  if (typeof body.size === "string") data.size = body.size || null;
  if (body.fitDetails === null || typeof body.fitDetails === "string") {
    data.fitDetails = body.fitDetails && String(body.fitDetails).trim() ? String(body.fitDetails) : null;
  }
  if (typeof body.fitNotes === "string") data.fitNotes = body.fitNotes || null;
  if (typeof body.notes === "string") data.notes = body.notes || null;

  // Brand: accept either an explicit brandId or free-form text. Free-form
  // text gets upserted into the Brand table for autocomplete + dedupe.
  if (typeof body.brandId === "string" && body.brandId) {
    const found = await prisma.brand.findFirst({ where: { id: body.brandId, ownerId: userId } });
    if (found) {
      data.brandId = found.id;
      data.brand = found.name;
    }
  } else if (typeof body.brand === "string") {
    const text = body.brand.trim();
    if (!text) {
      data.brand = null;
      data.brandId = null;
    } else {
      const key = brandKey(text);
      const upserted = await prisma.brand.upsert({
        where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
        update: {},
        create: { ownerId: userId, name: text, nameKey: key },
      });
      data.brand = upserted.name;
      data.brandId = upserted.id;
    }
  }
  if (Array.isArray(body.seasons)) data.seasons = listToCsv(body.seasons.map(String));
  if (Array.isArray(body.activities)) data.activities = listToCsv(body.activities.map(String));
  if (typeof body.category === "string") {
    if (!CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = body.category;
  }
  if (typeof body.status === "string") {
    if (!ITEM_STATUSES.includes(body.status as (typeof ITEM_STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status;
  }
  // Link or unlink from a matching set. Validates that the set
  // belongs to the same user.
  if (body.setId === null) {
    data.setId = null;
  } else if (typeof body.setId === "string" && body.setId) {
    const found = await prisma.itemSet.findFirst({ where: { id: body.setId, ownerId: userId } });
    if (!found) {
      return NextResponse.json({ error: "Set not found" }, { status: 400 });
    }
    data.setId = found.id;
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

  await prisma.outfitItem.deleteMany({ where: { itemId: id } });
  await prisma.item.delete({ where: { id } });

  for (const p of [item.imagePath, item.imageBgRemovedPath, item.labelImagePath].filter(Boolean) as string[]) {
    try {
      await fs.unlink(path.join(UPLOAD_ROOT, p));
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({ ok: true });
}
