import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { describeForOutfit, getForecast } from "@/lib/weather";
import { readSavedPick, writeSavedPick } from "@/lib/todayOutfit";
import { todayISO } from "@/lib/dates";

export const runtime = "nodejs";
// Pure text outfit pick — fast call, but allow headroom for slow models.
export const maxDuration = 60;

type EnrichedItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

async function rehydrate(userId: string, itemIds: string[]): Promise<EnrichedItem[]> {
  if (itemIds.length === 0) return [];
  const items = await prisma.item.findMany({
    where: { ownerId: userId, id: { in: itemIds } },
    select: {
      id: true, imagePath: true, imageBgRemovedPath: true,
      category: true, subType: true,
    },
  });
  // Preserve the order from itemIds (the AI's chosen sequence).
  const byId = new Map(items.map((i) => [i.id, i]));
  return itemIds.map((id) => byId.get(id)).filter((x): x is EnrichedItem => !!x);
}

// GET /api/ai/outfit/today
// Returns the user's saved pick for today (if any). Auto-clears at
// midnight via the date-equality check inside readSavedPick.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const saved = await readSavedPick(userId);
  if (!saved) return NextResponse.json({ saved: null });

  const pickedItems = await rehydrate(userId, saved.itemIds);
  return NextResponse.json({
    saved: {
      itemIds: saved.itemIds,
      pickedItems,
      name: saved.name,
      reasoning: saved.reasoning,
      weather: saved.weather,
    },
  });
}

// POST /api/ai/outfit/today
// Picks a fresh outfit for today, persists it for the rest of the day,
// returns enriched items. The dashboard renders the items as a tile grid;
// to see them composited on a mannequin, the user saves the outfit and
// hits "Generate AI try-on" in the style canvas.
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
  const again = body?.again === true;

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
  if (items.length === 0) {
    return NextResponse.json({ enabled: true, itemIds: [], message: "Your closet is empty." });
  }

  const day = new Date().toLocaleDateString(undefined, { weekday: "long" });
  let weatherLine = "";
  const prefs = await getPrefs();
  if (prefs.homeCity) {
    const f = await getForecast(prefs.homeCity);
    if (f) weatherLine = describeForOutfit(f);
  }
  const occasion = [
    again ? `Outfit for ${day} (try another)` : `Outfit for ${day}`,
    weatherLine ? `weather: ${weatherLine}` : "",
  ].filter(Boolean).join(" · ");

  const result = await provider.buildOutfit({
    occasion,
    items: items.map((i) => ({
      id: i.id,
      category: i.category,
      subType: i.subType,
      color: i.color,
      brand: i.brand,
      seasons: csvToList(i.seasons),
      activities: csvToList(i.activities),
    })),
    preferences: prefs.stylePreferences ?? undefined,
  });

  const pickedItems = await rehydrate(userId, result.itemIds);

  if (result.itemIds.length > 0) {
    await writeSavedPick(userId, {
      date: todayISO(),
      itemIds: result.itemIds,
      name: result.name ?? null,
      reasoning: result.reasoning ?? null,
      weather: weatherLine || null,
    });
  }

  return NextResponse.json({
    enabled: true,
    provider: provider.name,
    itemIds: result.itemIds,
    pickedItems,
    name: result.name,
    reasoning: result.reasoning,
    weather: weatherLine || null,
    debug: result.debug,
  });
}
