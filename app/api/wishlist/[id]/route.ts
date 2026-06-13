import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { WISHLIST_PRIORITIES } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  // Owner-scoped lookup — same findFirst({ id, ownerId }) shape as
  // every other route, instead of findUnique + post-hoc check.
  const existing = await prisma.wishlistItem.findFirst({ where: { id, ownerId: userId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (typeof body.category === "string") data.category = body.category.slice(0, 60) || null;
  if (typeof body.brand === "string") data.brand = body.brand.slice(0, 80) || null;
  if (typeof body.link === "string") data.link = body.link.slice(0, 2000) || null;
  if (typeof body.price === "string") data.price = body.price.slice(0, 60) || null;
  if (typeof body.occasion === "string") data.occasion = body.occasion.slice(0, 120) || null;
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 2000) || null;
  if (typeof body.fillsGap === "boolean") data.fillsGap = body.fillsGap;
  if (typeof body.giftIdea === "boolean") data.giftIdea = body.giftIdea;
  if (typeof body.purchased === "boolean") data.purchased = body.purchased;
  if (typeof body.priority === "string") {
    data.priority = WISHLIST_PRIORITIES.includes(body.priority as (typeof WISHLIST_PRIORITIES)[number])
      ? body.priority
      : "medium";
  }

  const updated = await prisma.wishlistItem.update({ where: { id }, data });

  // Distinguish "marked purchased" from a generic edit — that's the
  // milestone the user actually cares about seeing in the feed.
  const justMarkedPurchased = data.purchased === true && !existing.purchased;
  await logActivity({
    userId,
    kind: justMarkedPurchased ? "wishlist.purchased" : "wishlist.update",
    summary: justMarkedPurchased
      ? `Bought "${updated.name}" from wishlist`
      : `Edited wishlist item "${updated.name}"`,
    targetType: "WishlistItem",
    targetId: id,
  });

  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.wishlistItem.findFirst({ where: { id, ownerId: userId } });
  if (!existing) {
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

  await logActivity({
    userId,
    kind: "wishlist.delete",
    summary: `Removed "${existing.name}" from wishlist`,
    targetType: "WishlistItem",
    targetId: id,
  });

  return NextResponse.json({ ok: true });
}
