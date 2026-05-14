import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { LOOK_SLOTS } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// Looks — the makeup-only equivalent of Outfit. Same shape: a name,
// optional notes, and a set of (slot, itemId) pairs. Slots come from
// LOOK_SLOTS (15 fine-grained product-type slots, applied in natural
// routine order). Looks are paired one-to-one with an Outfit via
// Outfit.lookId; PR D wires that picker.
//
// Beauty items only — POST + PATCH validate that every referenced
// item belongs to the caller AND is flagged isBeauty=true so a
// clothing item can never accidentally end up in a Look.

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const looks = await prisma.look.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    // Card preview only needs the thumbnail bits + slot routing. Trim
    // every other Item field so a closet of 30+ looks doesn't drag
    // unused JSON over the wire.
    select: {
      id: true,
      name: true,
      notes: true,
      updatedAt: true,
      items: {
        select: {
          slot: true,
          item: {
            select: {
              id: true,
              imagePath: true,
              imageBgRemovedPath: true,
              category: true,
              subType: true,
              shadeName: true,
              shadeHex: true,
            },
          },
        },
      },
      _count: { select: { items: true } },
    },
  });

  return NextResponse.json({ looks });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120) || "Untitled look";
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 1000)
      : null;
  const itemsInput: Array<{ itemId: unknown; slot: unknown }> = Array.isArray(body.items)
    ? body.items
    : [];

  const candidate = itemsInput
    .filter(
      (x): x is { itemId: string; slot: string } =>
        !!x &&
        typeof x.itemId === "string" &&
        typeof x.slot === "string" &&
        (LOOK_SLOTS as readonly string[]).includes(x.slot),
    )
    .map((x) => ({ itemId: x.itemId, slot: x.slot }));

  if (candidate.length === 0) {
    return NextResponse.json(
      { error: "A look needs at least one product." },
      { status: 400 },
    );
  }

  // Owner-scope + beauty-flag guard. A Look can only contain beauty
  // items the caller owns; anything else gets filtered out before
  // the create. Mirrors the outfit POST owner-check pattern shipped
  // in the security audit.
  const owned = await prisma.item.findMany({
    where: {
      ownerId: userId,
      isBeauty: true,
      id: { in: candidate.map((c) => c.itemId) },
    },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((o) => o.id));
  const cleanItems = candidate.filter((c) => ownedIds.has(c.itemId));
  if (cleanItems.length === 0) {
    return NextResponse.json(
      { error: "A look needs at least one beauty product you own." },
      { status: 400 },
    );
  }

  const look = await prisma.look.create({
    data: {
      ownerId: userId,
      name,
      notes,
      items: { create: cleanItems },
    },
    include: { items: { include: { item: true } } },
  });

  await logActivity({
    userId,
    kind: "look.create",
    summary: `Saved look "${look.name}"`,
    targetType: "Look",
    targetId: look.id,
    meta: { products: cleanItems.length },
  });

  return NextResponse.json({ look });
}
