import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";

export const runtime = "nodejs";

// POST { destination?, startDate?, endDate?, activities?: string[],
//        occasion?, notes? }
// Returns { enabled, itemIds, reasoning?, packingNotes?, debug? }.
// Mirrors /api/ai/outfit: never writes to the DB, defers all decisions
// about whether to apply to the client.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.buildPackingList !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support packing-list suggestions yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const trip = {
    destination: typeof body.destination === "string" ? body.destination.trim() : undefined,
    startDate: typeof body.startDate === "string" ? body.startDate : undefined,
    endDate: typeof body.endDate === "string" ? body.endDate : undefined,
    activities: Array.isArray(body.activities)
      ? body.activities
          .filter((a: unknown): a is string => typeof a === "string")
          .map((a: string) => a.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
    occasion: typeof body.occasion === "string" ? body.occasion.trim() || undefined : undefined,
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 400) || undefined : undefined,
  };

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
  if (items.length === 0) {
    return NextResponse.json({ enabled: true, itemIds: [], message: "Your closet is empty." });
  }

  const result = await provider.buildPackingList({
    trip,
    items: items.map((i) => ({
      id: i.id,
      category: i.category,
      subType: i.subType,
      color: i.color,
      brand: i.brand,
      seasons: csvToList(i.seasons),
      activities: csvToList(i.activities),
    })),
  });

  return NextResponse.json({
    enabled: true,
    provider: provider.name,
    itemIds: result.itemIds,
    reasoning: result.reasoning,
    packingNotes: result.packingNotes,
    debug: result.debug,
  });
}
