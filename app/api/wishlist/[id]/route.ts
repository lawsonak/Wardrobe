import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { WISHLIST_PRIORITIES } from "@/lib/constants";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.wishlistItem.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.category === "string") data.category = body.category || null;
  if (typeof body.brand === "string") data.brand = body.brand || null;
  if (typeof body.link === "string") data.link = body.link || null;
  if (typeof body.price === "string") data.price = body.price || null;
  if (typeof body.occasion === "string") data.occasion = body.occasion || null;
  if (typeof body.notes === "string") data.notes = body.notes || null;
  if (typeof body.fillsGap === "boolean") data.fillsGap = body.fillsGap;
  if (typeof body.giftIdea === "boolean") data.giftIdea = body.giftIdea;
  if (typeof body.purchased === "boolean") data.purchased = body.purchased;
  if (typeof body.priority === "string") {
    data.priority = WISHLIST_PRIORITIES.includes(body.priority as (typeof WISHLIST_PRIORITIES)[number])
      ? body.priority
      : "medium";
  }

  const updated = await prisma.wishlistItem.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.wishlistItem.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.wishlistItem.delete({ where: { id } });

  if (existing.imagePath) {
    try {
      await fs.unlink(path.join(UPLOAD_ROOT, existing.imagePath));
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({ ok: true });
}
