import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { LOOK_SLOTS } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// GET /api/looks/[id] — single look detail. Owner-scoped lookup;
// returns 404 for ids that don't belong to the caller.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const look = await prisma.look.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!look) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ look });
}

// PATCH /api/looks/[id] — partial update. Accepts:
//   - name (string)
//   - notes (string | null)
//   - items (full replacement of the (slot, itemId) set when present)
//
// Item-set replacement uses the same owner + isBeauty guard as POST.
// Outfits cleared their tryOnHash when items changed; Looks have no
// derived cache to invalidate (PR C ships static collages, no
// try-on render).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.look.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const next = body.name.trim().slice(0, 120);
    if (next) data.name = next;
  }
  if (body.notes === null) data.notes = null;
  else if (typeof body.notes === "string") {
    data.notes = body.notes.trim().slice(0, 1000) || null;
  }

  let pendingItems: Array<{ itemId: string; slot: string }> | null = null;
  if (Array.isArray(body.items)) {
    const candidate = (body.items as Array<{ itemId: unknown; slot: unknown }>)
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
    const owned = await prisma.item.findMany({
      where: {
        ownerId: userId,
        isBeauty: true,
        id: { in: candidate.map((c) => c.itemId) },
      },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));
    pendingItems = candidate.filter((c) => ownedIds.has(c.itemId));
    if (pendingItems.length === 0) {
      return NextResponse.json(
        { error: "None of those products belong to you." },
        { status: 400 },
      );
    }
  }

  const look = await prisma.$transaction(async (tx) => {
    if (pendingItems) {
      await tx.lookItem.deleteMany({ where: { lookId: id } });
      await tx.lookItem.createMany({
        data: pendingItems.map((p) => ({ lookId: id, slot: p.slot, itemId: p.itemId })),
      });
    }
    return tx.look.update({
      where: { id },
      data,
      include: { items: { include: { item: true } } },
    });
  });

  await logActivity({
    userId,
    kind: "look.update",
    summary: `Edited look "${look.name}"`,
    targetType: "Look",
    targetId: id,
  });

  return NextResponse.json({ look });
}

// DELETE /api/looks/[id] — owner-scoped. LookItem rows cascade via
// the schema; we just nuke the Look row. Outfit.lookId on any paired
// outfits gets set to null via ON DELETE SET NULL.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.look.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.look.delete({ where: { id } });
  await logActivity({
    userId,
    kind: "look.delete",
    summary: `Deleted look "${existing.name}"`,
    targetType: "Look",
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
