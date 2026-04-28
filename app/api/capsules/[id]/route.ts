import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

async function ownerCheck(id: string, userId: string) {
  return prisma.capsule.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
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
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.occasion === "string") data.occasion = body.occasion.trim() || null;
  if (typeof body.season === "string") data.season = body.season.trim() || null;

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
      prisma.capsuleItem.deleteMany({ where: { capsuleId: id } }),
      prisma.capsuleItem.createMany({
        data: validIds.map((itemId) => ({ capsuleId: id, itemId })),
      }),
    ]);
  }

  const capsule = await prisma.capsule.update({ where: { id }, data, include: { items: true } });
  return NextResponse.json({ capsule });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownerCheck(id, userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.capsule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
