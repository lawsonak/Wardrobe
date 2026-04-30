import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/sets/[id] — full set + member items.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const set = await prisma.itemSet.findFirst({
    where: { id, ownerId: userId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ set });
}

// PATCH /api/sets/[id] { name?, notes?, itemIds?: string[] }
//
// Renames + updates notes. When itemIds is sent, replaces the
// entire member set: items not in the list have their setId
// cleared; items in the list have their setId set to this set.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const set = await prisma.itemSet.findFirst({ where: { id, ownerId: userId } });
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    data.name = name.slice(0, 80);
  }
  if (body?.notes === null) data.notes = null;
  else if (typeof body?.notes === "string") {
    data.notes = body.notes.trim().slice(0, 500) || null;
  }

  await prisma.itemSet.update({ where: { id }, data });

  if (Array.isArray(body?.itemIds)) {
    const requested = (body.itemIds as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
    // Clear members not in the new list.
    await prisma.item.updateMany({
      where: { ownerId: userId, setId: id, id: { notIn: requested } },
      data: { setId: null },
    });
    // Add new members (items not yet in this set).
    if (requested.length > 0) {
      await prisma.item.updateMany({
        where: { ownerId: userId, id: { in: requested } },
        data: { setId: id },
      });
    }
  }

  const updated = await prisma.itemSet.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ set: updated });
}

// DELETE /api/sets/[id] — items keep their fields (setId becomes
// null automatically via the schema's onDelete: SetNull).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const set = await prisma.itemSet.findFirst({ where: { id, ownerId: userId } });
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.itemSet.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
