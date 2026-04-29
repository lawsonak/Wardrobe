import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { describeForOutfit, getForecast } from "@/lib/weather";

export const runtime = "nodejs";

// POST { occasion: string, season?: string, activity?: string, useWeather?: boolean }
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
  const useWeather = body.useWeather !== false; // default true

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
  if (items.length === 0) {
    return NextResponse.json({ enabled: true, itemIds: [], message: "Your closet is empty." });
  }

  // Optional weather hint. Free, no API key — falls back silently if
  // the home city isn't set or the geocoder doesn't recognize it.
  let weatherLine = "";
  if (useWeather) {
    const prefs = await getPrefs();
    if (prefs.homeCity) {
      const f = await getForecast(prefs.homeCity);
      if (f) weatherLine = describeForOutfit(f);
    }
  }

  const result = await provider.buildOutfit({
    occasion: [
      occasion,
      season ? `season: ${season}` : "",
      activity ? `activity: ${activity}` : "",
      weatherLine ? `weather: ${weatherLine}` : "",
    ]
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
    // Enriched: full picked items so callers (e.g. the dashboard's
    // "Plan today's look" card) can render them inline on the
    // mannequin without a follow-up round trip.
    pickedItems: result.itemIds
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is (typeof items)[number] => !!it)
      .map((it) => ({
        id: it.id,
        imagePath: it.imagePath,
        imageBgRemovedPath: it.imageBgRemovedPath,
        category: it.category,
        subType: it.subType,
      })),
    name: result.name,
    reasoning: result.reasoning,
    weather: weatherLine || null,
    debug: result.debug,
  });
}
