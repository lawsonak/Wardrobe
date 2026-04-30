import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/sets — list this user's sets with member counts.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sets = await prisma.itemSet.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        select: {
          id: true, imagePath: true, imageBgRemovedPath: true,
          category: true, subType: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return NextResponse.json({ sets });
}

// POST /api/sets { name, notes?, itemIds?: string[] }
//
// Creates a new set. When itemIds is provided, those items are
// linked into the set immediately. Items in another set get moved
// (one item belongs to at most one set at a time).
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
  const itemIds: string[] = Array.isArray(body?.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const set = await prisma.itemSet.create({
    data: {
      ownerId: userId,
      name: name.slice(0, 80),
      notes: notes ? notes.slice(0, 500) : null,
    },
  });

  if (itemIds.length > 0) {
    await prisma.item.updateMany({
      where: { id: { in: itemIds }, ownerId: userId },
      data: { setId: set.id },
    });
  }

  const withItems = await prisma.itemSet.findUnique({
    where: { id: set.id },
    include: { items: true },
  });
  return NextResponse.json({ set: withItems });
}
