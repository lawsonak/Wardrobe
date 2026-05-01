import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listToCsv } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const collections = await prisma.collection.findMany({
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
  return NextResponse.json({ collections });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const kind = body.kind === "trip" ? "trip" : "general";
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const occasion = typeof body.occasion === "string" ? body.occasion.trim() || null : null;
  const season = typeof body.season === "string" ? body.season.trim() || null : null;
  const destination = typeof body.destination === "string" ? body.destination.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  const activities = Array.isArray(body.activities)
    ? listToCsv(
        (body.activities as unknown[])
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 20),
      )
    : "";
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

  const collection = await prisma.collection.create({
    data: {
      ownerId: userId,
      kind,
      name,
      description,
      occasion,
      season,
      destination,
      startDate,
      endDate,
      notes,
      activities,
      items: {
        create: validIds.map((itemId) => ({ itemId })),
      },
    },
    include: { items: true },
  });

  return NextResponse.json({ collection }, { status: 201 });
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}
