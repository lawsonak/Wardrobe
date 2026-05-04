import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listToCsv } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

async function ownerCheck(id: string, userId: string) {
  return prisma.collection.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownerCheck(id, userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.kind === "trip" || body.kind === "general") data.kind = body.kind;
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.occasion === "string") data.occasion = body.occasion.trim() || null;
  if (typeof body.season === "string") data.season = body.season.trim() || null;
  if (typeof body.destination === "string") data.destination = body.destination.trim() || null;
  if (typeof body.notes === "string") data.notes = body.notes.trim() || null;
  if ("startDate" in body) data.startDate = parseDate(body.startDate);
  if ("endDate" in body) data.endDate = parseDate(body.endDate);
  if (Array.isArray(body.activities)) {
    data.activities = listToCsv(
      (body.activities as unknown[])
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 20),
    );
  }

  // Replace the item set if provided. addItem/removeItem endpoints stay
  // simpler for incremental edits.
  if (Array.isArray(body.itemIds)) {
    const ids: string[] = body.itemIds.map(String).filter(Boolean);
    const owned = await prisma.item.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: { id: true },
    });
    const validIds = owned.map((o) => o.id);
    await prisma.$transaction([
      prisma.collectionItem.deleteMany({ where: { collectionId: id } }),
      prisma.collectionItem.createMany({
        data: validIds.map((itemId) => ({ collectionId: id, itemId })),
      }),
    ]);
  }

  const collection = await prisma.collection.update({ where: { id }, data, include: { items: true } });

  await logActivity({
    userId,
    kind: "collection.update",
    summary: `Edited collection "${collection.name}"`,
    targetType: "Collection",
    targetId: id,
  });

  return NextResponse.json({ collection });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.collection.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.collection.delete({ where: { id } });
  await logActivity({
    userId,
    kind: "collection.delete",
    summary: `Deleted collection "${existing.name}"`,
    targetType: "Collection",
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}
