import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SLOTS, type Slot } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const activity = searchParams.get("activity") || undefined;
  const season = searchParams.get("season") || undefined;
  const fav = searchParams.get("fav") === "1";

  const outfits = await prisma.outfit.findMany({
    where: {
      // Owner-scope guard. Without this the endpoint returned every
      // user's outfits to any authenticated caller.
      ownerId: userId,
      ...(activity ? { activity } : {}),
      ...(season ? { season } : {}),
      ...(fav ? { isFavorite: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { items: { include: { item: true } } },
  });
  return NextResponse.json({ outfits });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = String(body.name || "").trim() || "Untitled outfit";
  const activity = typeof body.activity === "string" && body.activity ? body.activity : null;
  const season = typeof body.season === "string" && body.season ? body.season : null;
  const isFavorite = !!body.isFavorite;
  const itemsInput: Array<{ itemId: string; slot: string }> = Array.isArray(body.items)
    ? body.items
    : [];

  const cleanItems = itemsInput
    .filter((x) => typeof x.itemId === "string" && SLOTS.includes(x.slot as Slot))
    .map((x) => ({ itemId: x.itemId, slot: x.slot }));

  if (cleanItems.length === 0) {
    return NextResponse.json({ error: "An outfit needs at least one piece." }, { status: 400 });
  }

  const outfit = await prisma.outfit.create({
    data: {
      ownerId: userId,
      name,
      activity,
      season,
      isFavorite,
      items: { create: cleanItems },
    },
    include: { items: { include: { item: true } } },
  });

  return NextResponse.json({ outfit });
}
