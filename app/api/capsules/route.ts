import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  parseActivityTargets,
  parseTargetCounts,
  serializeActivityTargets,
  serializeTargetCounts,
} from "@/lib/capsulePlan";

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
  const location = typeof body.location === "string" ? body.location.trim() || null : null;
  let dateNeeded: Date | null = null;
  if (typeof body.dateNeeded === "string" && body.dateNeeded.trim()) {
    const d = new Date(body.dateNeeded);
    if (!Number.isNaN(d.getTime())) dateNeeded = d;
  }
  const targetCounts = serializeTargetCounts(parseTargetCounts(
    typeof body.targetCounts === "string"
      ? body.targetCounts
      : body.targetCounts ? JSON.stringify(body.targetCounts) : null,
  ));
  const activityTargets = serializeActivityTargets(parseActivityTargets(
    typeof body.activityTargets === "string"
      ? body.activityTargets
      : body.activityTargets ? JSON.stringify(body.activityTargets) : null,
  ));
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
      location,
      dateNeeded,
      targetCounts,
      activityTargets,
      items: {
        create: validIds.map((itemId) => ({ itemId })),
      },
    },
    include: { items: true },
  });

  return NextResponse.json({ capsule }, { status: 201 });
}
