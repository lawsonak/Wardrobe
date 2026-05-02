import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { describeForOutfit, getForecast } from "@/lib/weather";
import { readSavedPick, writeSavedPick } from "@/lib/todayOutfit";
import { todayISO } from "@/lib/dates";
import { saveBuffer, unlinkUpload } from "@/lib/uploads";
import { composeOutfitForItems, type ComposeItem } from "@/lib/ai/composeTryOn";

export const runtime = "nodejs";
// Pick is fast; the try-on compose adds 5-15s. 90 buys headroom.
export const maxDuration = 90;

type EnrichedItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
};

async function rehydrate(userId: string, itemIds: string[]): Promise<EnrichedItem[]> {
  if (itemIds.length === 0) return [];
  const items = await prisma.item.findMany({
    where: { ownerId: userId, id: { in: itemIds } },
    select: {
      id: true, imagePath: true, imageBgRemovedPath: true,
      category: true, subType: true, color: true,
    },
  });
  // Preserve the order from itemIds (the AI's chosen sequence).
  const byId = new Map(items.map((i) => [i.id, i]));
  return itemIds.map((id) => byId.get(id)).filter((x): x is EnrichedItem => !!x);
}

// Try the AI try-on compose for the picked items; on success, write
// the PNG to the user's upload dir and return the relative path. On
// failure (no mannequin, Gemini error, no garments loaded), return
// null and a hint — the dashboard falls back to the tile grid.
async function composeAndPersist(
  userId: string,
  pickedItems: EnrichedItem[],
  previousPath: string | null,
): Promise<{ tryOnImagePath: string | null; tryOnError?: string }> {
  if (pickedItems.length === 0) return { tryOnImagePath: null };
  const composeItems: ComposeItem[] = pickedItems.map((it) => ({
    id: it.id,
    imagePath: it.imagePath,
    imageBgRemovedPath: it.imageBgRemovedPath,
    category: it.category,
    subType: it.subType,
    color: it.color,
  }));
  const result = await composeOutfitForItems({ userId, items: composeItems });
  if (!result.ok) {
    return { tryOnImagePath: null, tryOnError: result.error };
  }
  const ext = result.mimeType === "image/jpeg" ? "jpg" : "png";
  // Date-stamped filename so two days in a row don't fight over the
  // same path; old day rolls off via cleanup-orphans + the date check.
  const newPath = await saveBuffer(
    userId,
    "todays-outfit",
    result.pngBuffer,
    `tryon-${todayISO()}`,
    ext,
  );
  if (previousPath && previousPath !== newPath) {
    await unlinkUpload(previousPath);
  }
  return { tryOnImagePath: newPath };
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
      tryOnImagePath: saved.tryOnImagePath ?? null,
    },
  });
}

// POST /api/ai/outfit/today
// Picks a fresh outfit for today, asks Gemini to composite the
// dressed-mannequin try-on for it, persists both for the rest of the
// day, returns enriched items + tryOnImagePath. The dashboard auto-
// fires this once per morning.
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

  // "Try another" path: pass the previous pick's item ids as a hard
  // exclusion so the model can't return the same outfit. Without this,
  // the catalog + occasion + preferences are nearly identical between
  // runs and Gemini reliably converges on the same picks.
  const previousPick = again ? await readSavedPick(userId) : null;
  const avoidItemIds = previousPick?.itemIds ?? [];

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
    avoidItemIds,
  });

  const pickedItems = await rehydrate(userId, result.itemIds);

  // Read the previous saved pick (if any) so we can replace the old
  // tryon PNG on disk in lockstep with the new one.
  const previous = previousPick ?? (await readSavedPick(userId));
  const previousTryOn = previous?.tryOnImagePath ?? null;

  // Try-on compose. Failure is non-fatal — the dashboard falls back
  // to the item tile grid.
  const compose =
    pickedItems.length > 0
      ? await composeAndPersist(userId, pickedItems, previousTryOn)
      : { tryOnImagePath: null as string | null };

  if (result.itemIds.length > 0) {
    await writeSavedPick(userId, {
      date: todayISO(),
      itemIds: result.itemIds,
      name: result.name ?? null,
      reasoning: result.reasoning ?? null,
      weather: weatherLine || null,
      tryOnImagePath: compose.tryOnImagePath,
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
    tryOnImagePath: compose.tryOnImagePath,
    tryOnError: "tryOnError" in compose ? compose.tryOnError : undefined,
    debug: result.debug,
  });
}
