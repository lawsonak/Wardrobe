import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { describeForOutfit, getForecast } from "@/lib/weather";
import {
  readSavedPick,
  writeSavedPick,
  type SavedPickItemLayout,
} from "@/lib/todayOutfit";
import { todayISO } from "@/lib/wear";
import { getMannequinForUser } from "@/lib/mannequin";
import { extractItemFits } from "@/lib/ai/itemFit";

export const runtime = "nodejs";
// Pick + fit-pass combined can hit ~30s on a flaky model. 90 buys headroom.
export const maxDuration = 90;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

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

async function readUpload(rel: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const full = path.resolve(path.join(UPLOAD_ROOT, rel));
    if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return null;
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" :
      "image/jpeg";
    return { buf, mime };
  } catch {
    return null;
  }
}

// Best-effort: ask Gemini to compute per-item placement on the
// mannequin. Failure is non-fatal — the canvas falls back to the
// landmark slot defaults.
async function computeLayout(
  userId: string,
  itemsInOrder: EnrichedItem[],
): Promise<SavedPickItemLayout[] | undefined> {
  const mannequin = await getMannequinForUser(userId);
  if (!mannequin.url || !mannequin.renderedAbsPath) return undefined;
  const mannequinFile = await readUpload(`${userId}/mannequin.png`);
  if (!mannequinFile) return undefined;

  const itemFiles: Array<{ buffer: Buffer; mime: string; category: string; subType: string | null }> = [];
  for (const it of itemsInOrder) {
    const p = it.imageBgRemovedPath ?? it.imagePath;
    const file = await readUpload(p);
    if (!file) continue;
    itemFiles.push({
      buffer: file.buf,
      mime: file.mime,
      category: it.category,
      subType: it.subType,
    });
  }
  if (itemFiles.length !== itemsInOrder.length) return undefined;

  const result = await extractItemFits({
    mannequin: { buffer: mannequinFile.buf, mime: mannequinFile.mime },
    items: itemFiles,
  });
  if (!result.ok) return undefined;
  return itemsInOrder.map((it, i) => ({
    itemId: it.id,
    x: result.fits[i]?.x ?? 50,
    y: result.fits[i]?.y ?? 50,
    w: result.fits[i]?.w ?? 40,
    rotation: result.fits[i]?.rotation ?? 0,
  }));
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
      layout: saved.layout ?? null,
    },
  });
}

// POST /api/ai/outfit/today
// Picks a fresh outfit for today, asks AI for per-item placement on
// the mannequin, persists both, returns enriched items + layout.
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
  });

  // Rehydrate before fit-pass so we have everything in order.
  const pickedItems = await rehydrate(userId, result.itemIds);

  let layout: SavedPickItemLayout[] | undefined;
  if (pickedItems.length > 0) {
    layout = await computeLayout(userId, pickedItems);
  }

  if (result.itemIds.length > 0) {
    await writeSavedPick(userId, {
      date: todayISO(),
      itemIds: result.itemIds,
      name: result.name ?? null,
      reasoning: result.reasoning ?? null,
      weather: weatherLine || null,
      layout,
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
    layout: layout ?? null,
    debug: result.debug,
  });
}
