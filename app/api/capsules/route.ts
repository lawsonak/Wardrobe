import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const capsules = await prisma.capsule.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        include: { item: true },
        take: 6,
      },
      _count: { select: { items: true } },
    },
  });
  return NextResponse.json({ capsules });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const occasion = typeof body.occasion === "string" ? body.occasion.trim() || null : null;
  const season = typeof body.season === "string" ? body.season.trim() || null : null;
  const itemIds: string[] = Array.isArray(body.itemIds)
    ? body.itemIds.map(String).filter(Boolean)
    : [];

  // Verify the items belong to this user before linking.
  let validIds: string[] = [];
  if (itemIds.length > 0) {
    const owned = await prisma.item.findMany({
      where: { id: { in: itemIds }, ownerId: userId },
      select: { id: true },
    });
    validIds = owned.map((o) => o.id);
  }

  const capsule = await prisma.capsule.create({
    data: {
      ownerId: userId,
      name,
      description,
      occasion,
      season,
      items: {
        create: validIds.map((itemId) => ({ itemId })),
      },
    },
    include: { items: true },
  });

  return NextResponse.json({ capsule }, { status: 201 });
}
