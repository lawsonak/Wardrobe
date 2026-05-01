import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SLOTS, type Slot } from "@/lib/constants";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim() || "Untitled outfit";
  if (typeof body.isFavorite === "boolean") data.isFavorite = body.isFavorite;
  if (typeof body.activity === "string") data.activity = body.activity || null;
  if (typeof body.season === "string") data.season = body.season || null;
  if (body.layoutJson === null) {
    data.layoutJson = null;
  } else if (typeof body.layoutJson === "string") {
    try {
      JSON.parse(body.layoutJson);
      data.layoutJson = body.layoutJson;
    } catch {
      return NextResponse.json({ error: "Invalid layout JSON" }, { status: 400 });
    }
  }

  const existing = await prisma.outfit.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If the client sends `items`, replace the OutfitItem set in one
  // transaction. Validates that all referenced items belong to this user.
  let pendingItems: Array<{ slot: Slot; itemId: string }> | null = null;
  if (Array.isArray(body.items)) {
    const cleaned: Array<{ slot: Slot; itemId: string }> = [];
    for (const raw of body.items) {
      if (!raw || typeof raw !== "object") continue;
      const slot = String(raw.slot) as Slot;
      const itemId = String(raw.itemId);
      if (!SLOTS.includes(slot) || !itemId) continue;
      cleaned.push({ slot, itemId });
    }
    if (cleaned.length === 0) {
      return NextResponse.json({ error: "An outfit needs at least one piece." }, { status: 400 });
    }
    const owned = await prisma.item.findMany({
      where: { ownerId: userId, id: { in: cleaned.map((c) => c.itemId) } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));
    pendingItems = cleaned.filter((c) => ownedIds.has(c.itemId));
    if (pendingItems.length === 0) {
      return NextResponse.json({ error: "None of those items belong to you." }, { status: 400 });
    }
  }

  const outfit = await prisma.$transaction(async (tx) => {
    if (pendingItems) {
      await tx.outfitItem.deleteMany({ where: { outfitId: id } });
      await tx.outfitItem.createMany({
        data: pendingItems.map((p) => ({ outfitId: id, slot: p.slot, itemId: p.itemId })),
      });
      // Replacing the item set invalidates any cached try-on image. The
      // file stays on disk until the next regeneration or orphan sweep —
      // serving a stale-but-related image is better than a broken card.
      data.tryOnHash = null;
    }
    return tx.outfit.update({
      where: { id },
      data,
      include: { items: { include: { item: true } } },
    });
  });

  return NextResponse.json({ outfit });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.outfit.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.outfit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
