import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { todayISO } from "@/lib/dates";
import {
  readSavedSuggestion,
  writeSavedSuggestion,
  type SavedSuggestion,
} from "@/lib/todaysSuggestion";
import {
  suggestProductForCloset,
  type ClosetSummary,
} from "@/lib/ai/styleSuggestion";

export const runtime = "nodejs";
// Grounded search + content fetch can take 5-15s. Allow generous headroom.
export const maxDuration = 60;

// In-process per-user lock so a refresh-button-mash doesn't burn two
// grounded search calls back to back.
const inflight = new Set<string>();

async function buildClosetSummary(userId: string): Promise<ClosetSummary> {
  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    select: {
      brand: true,
      color: true,
      category: true,
      subType: true,
      isFavorite: true,
    },
  });

  const brandTally = new Map<string, number>();
  const colorTally = new Map<string, number>();
  const categoryCounts: Record<string, number> = {};
  for (const c of CATEGORIES) categoryCounts[c] = 0;
  const subTypeSet = new Set<string>();
  let favoriteCount = 0;

  for (const it of items) {
    if (it.brand && it.brand.trim()) {
      const k = it.brand.trim();
      brandTally.set(k, (brandTally.get(k) ?? 0) + 1);
    }
    if (it.color && it.color.trim()) {
      const k = it.color.trim();
      colorTally.set(k, (colorTally.get(k) ?? 0) + 1);
    }
    if (it.category && (CATEGORIES as readonly string[]).includes(it.category)) {
      categoryCounts[it.category as Category]! += 1;
    }
    if (it.subType && it.subType.trim()) {
      subTypeSet.add(it.subType.trim());
    }
    if (it.isFavorite) favoriteCount++;
  }

  const sortByCount = <T,>(m: Map<T, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name: String(name), count }));

  const prefs = await getPrefs();

  return {
    totalItems: items.length,
    topBrands: sortByCount(brandTally).slice(0, 5),
    topColors: sortByCount(colorTally).slice(0, 5),
    categoryCounts,
    favoriteCount,
    stylePreferences: prefs.stylePreferences,
    ownedSubTypes: Array.from(subTypeSet),
  };
}

// GET — return today's saved suggestion (if any). No AI call.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const saved = await readSavedSuggestion(userId);
  return NextResponse.json({ saved });
}

// POST — generate a fresh suggestion. Saves to disk for the rest of
// the day. Body { again: true } nudges the model toward a different
// option than whatever's currently saved.
export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        enabled: false,
        message:
          "AI is disabled. Set GEMINI_API_KEY in .env to enable Today's suggestion.",
      },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const again = body?.again === true;

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A suggestion is already generating for your account." },
      { status: 409 },
    );
  }
  inflight.add(userId);

  try {
    const summary = await buildClosetSummary(userId);
    if (summary.totalItems === 0) {
      return NextResponse.json(
        {
          enabled: true,
          error: "Closet is empty — add a few pieces first so AI can read your style.",
        },
        { status: 400 },
      );
    }

    const result = await suggestProductForCloset(summary, { again });
    if (!result.ok) {
      return NextResponse.json(
        { enabled: true, error: result.error, debug: result.debug },
        { status: 502 },
      );
    }

    const saved: SavedSuggestion = {
      date: todayISO(),
      ...result.suggestion,
      sources: (result.debug.sources ?? []).slice(0, 8),
    };
    await writeSavedSuggestion(userId, saved);

    return NextResponse.json({
      enabled: true,
      saved,
      debug: result.debug,
    });
  } finally {
    inflight.delete(userId);
  }
}
