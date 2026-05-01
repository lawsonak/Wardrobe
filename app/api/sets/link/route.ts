import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/sets/link { itemAId, itemBId }
//
// Smart link helper for the item-detail "pick the matching piece"
// flow. Cases:
//   - Neither item in a set → create a new set named after both
//     subtypes ("Bikini top + Bikini bottom") and add both.
//   - Exactly one item in a set → add the other to that set.
//   - Both items already in the same set → no-op.
//   - Both items in different sets → preserve A's set, move B to it.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const itemAId = typeof body?.itemAId === "string" ? body.itemAId : "";
  const itemBId = typeof body?.itemBId === "string" ? body.itemBId : "";
  if (!itemAId || !itemBId || itemAId === itemBId) {
    return NextResponse.json({ error: "Need two distinct items" }, { status: 400 });
  }

  const items = await prisma.item.findMany({
    where: { ownerId: userId, id: { in: [itemAId, itemBId] } },
    select: { id: true, subType: true, category: true, setId: true },
  });
  if (items.length !== 2) {
    return NextResponse.json({ error: "Items not found" }, { status: 404 });
  }
  const a = items.find((i) => i.id === itemAId);
  const b = items.find((i) => i.id === itemBId);
  if (!a || !b) {
    return NextResponse.json({ error: "Items not found" }, { status: 404 });
  }

  let setId: string;
  if (a.setId && b.setId && a.setId === b.setId) {
    setId = a.setId;
  } else if (a.setId) {
    setId = a.setId;
    if (b.setId !== setId) {
      await prisma.item.update({ where: { id: b.id }, data: { setId } });
    }
  } else if (b.setId) {
    setId = b.setId;
    await prisma.item.update({ where: { id: a.id }, data: { setId } });
  } else {
    const namePieces = [a.subType, b.subType].filter(
      (x): x is string => !!x && x.trim().length > 0,
    );
    const name = (namePieces.length === 2 ? namePieces.join(" + ") : "Matching set").slice(0, 80);
    const set = await prisma.itemSet.create({ data: { ownerId: userId, name } });
    setId = set.id;
    await prisma.item.updateMany({
      where: { ownerId: userId, id: { in: [a.id, b.id] } },
      data: { setId },
    });
  }

  const set = await prisma.itemSet.findUnique({
    where: { id: setId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ set });
}
