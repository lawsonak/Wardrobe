import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";

export const runtime = "nodejs";

// POST { occasion: string, season?: string, activity?: string }
// Returns { itemIds: string[], name?: string, reasoning?: string } —
// just the picked item ids; the client routes the user into the builder
// pre-filled. Never writes to the DB itself.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.buildOutfit !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support outfit suggestions yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const occasion = String(body.occasion ?? "").trim();
  if (!occasion) return NextResponse.json({ error: "occasion required" }, { status: 400 });
  const season = typeof body.season === "string" ? body.season.trim() : "";
  const activity = typeof body.activity === "string" ? body.activity.trim() : "";

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
  if (items.length === 0) {
    return NextResponse.json({ enabled: true, itemIds: [], message: "Your closet is empty." });
  }

  const result = await provider.buildOutfit({
    occasion: [occasion, season ? `season: ${season}` : "", activity ? `activity: ${activity}` : ""]
      .filter(Boolean)
      .join(" · "),
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
    name: result.name,
    reasoning: result.reasoning,
    debug: result.debug,
  });
}
