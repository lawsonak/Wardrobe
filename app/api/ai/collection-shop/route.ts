import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { csvToList } from "@/lib/constants";
import { computePackingTargets } from "@/lib/packingTargets";
import { buildClosetSummary } from "@/lib/ai/closetSummary";
import { findItemsForCollection } from "@/lib/ai/collectionShop";
import { getTripForecast } from "@/lib/weather";

export const runtime = "nodejs";
// Grounded search across many products is slower than a single-product
// lookup; allow generous headroom.
export const maxDuration = 60;

// In-process per-user lock so a refresh-button-mash doesn't burn two
// grounded search calls back to back.
const inflight = new Set<string>();

function nightsBetween(start: Date | null, end: Date | null): number | null {
  if (!start) return null;
  const e = end ?? start;
  const ms = e.getTime() - start.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function toISODate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        enabled: false,
        message:
          "AI is disabled. Set GEMINI_API_KEY in .env to enable Shop for this trip.",
      },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    collectionId?: unknown;
    intensity?: unknown;
  };
  const collectionId = typeof body.collectionId === "string" ? body.collectionId : "";
  const intensityRaw =
    typeof body.intensity === "number"
      ? body.intensity
      : typeof body.intensity === "string"
        ? Number(body.intensity)
        : 50;
  const intensity = Number.isFinite(intensityRaw) ? Math.max(0, Math.min(100, intensityRaw)) : 50;
  if (!collectionId) {
    return NextResponse.json({ error: "collectionId required" }, { status: 400 });
  }

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId: userId },
  });
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Per-user lock — debounces UI mashing without blocking other users.
  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A shop search is already running for your account." },
      { status: 409 },
    );
  }
  inflight.add(userId);

  try {
    const activities = csvToList(collection.activities);
    const nights = nightsBetween(collection.startDate, collection.endDate);
    const targets = computePackingTargets(nights, activities);

    // Weather is best-effort. We only have a city to geocode for trips
    // (themed sets don't have a destination); if Open-Meteo is down or
    // the trip is more than 16 days out, we hand the model a season
    // hint instead via the prompt.
    const forecast =
      collection.kind === "trip" && collection.destination && collection.destination.trim()
        ? await getTripForecast(
            collection.destination,
            toISODate(collection.startDate),
            toISODate(collection.endDate),
          )
        : null;

    const closet = await buildClosetSummary(userId);

    const result = await findItemsForCollection({
      kind: collection.kind === "trip" ? "trip" : "general",
      name: collection.name,
      destination: collection.destination,
      startDate: toISODate(collection.startDate),
      endDate: toISODate(collection.endDate),
      nights,
      occasion: collection.occasion,
      season: collection.season,
      activities,
      notes: collection.notes,
      closet,
      weather: forecast,
      targets,
      intensity,
    });

    if (!result.ok) {
      return NextResponse.json(
        { enabled: true, error: result.error, debug: result.debug },
        { status: 502 },
      );
    }

    return NextResponse.json({
      enabled: true,
      products: result.products,
      weather: forecast,
      targets,
      intensity,
      debug: result.debug,
    });
  } finally {
    inflight.delete(userId);
  }
}
