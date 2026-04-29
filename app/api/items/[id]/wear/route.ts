import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { appendWear, todayISO } from "@/lib/wear";

export const runtime = "nodejs";

// POST /api/items/[id]/wear
// Appends `[Worn: YYYY-MM-DD]` to the item's notes so we can compute
// dormancy and wear counts without a schema migration. Idempotent
// per-day — tapping the button twice on the same day does nothing.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await prisma.item.findFirst({ where: { id, ownerId: userId } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next = appendWear(item.notes, todayISO());
  if (next === (item.notes ?? "")) {
    return NextResponse.json({ ok: true, alreadyMarked: true });
  }

  const updated = await prisma.item.update({
    where: { id },
    data: { notes: next },
  });
  return NextResponse.json({ ok: true, item: updated });
}
