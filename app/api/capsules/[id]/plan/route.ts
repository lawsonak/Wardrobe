import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { csvToList, slotForItem } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";
import { describeForOutfit, getForecast } from "@/lib/weather";
import { parseActivityTargets, parseTargetCounts } from "@/lib/capsulePlan";

export const runtime = "nodejs";
// AI call returns N outfits in one shot — comfortable headroom for big trips.
export const maxDuration = 90;

// POST /api/capsules/[id]/plan { replaceExisting?: boolean }
//
// Generates one Outfit per `activityTarget.count` row using the
// capsule's items as the catalog (or the full closet if the capsule
// is empty). Each outfit is saved with `capsuleId` so the detail
// page can list them. When `replaceExisting=true` we delete the
// previously-generated outfits for this capsule first so the user
// can re-plan without manual cleanup.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const capsule = await prisma.capsule.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!capsule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.planTrip !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support trip planning yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const replaceExisting = body?.replaceExisting === true;

  const targets = parseActivityTargets(capsule.activityTargets);
  if (targets.length === 0) {
    return NextResponse.json(
      { enabled: true, error: "Add at least one outfit target before planning." },
      { status: 400 },
    );
  }

  // Catalog. Prefer the capsule's curated pieces; fall back to the
  // full active closet if the user hasn't picked anything yet so
  // they get a useful first plan.
  const catalogItems = capsule.items.length > 0
    ? capsule.items.map((ci) => ci.item)
    : await prisma.item.findMany({
        where: { ownerId: userId, status: "active" },
        orderBy: { createdAt: "desc" },
        take: 250,
      });

  if (catalogItems.length === 0) {
    return NextResponse.json(
      { enabled: true, error: "No items available — add some pieces first." },
      { status: 400 },
    );
  }

  // Weather hint. Try the capsule's location first, then fall back
  // to the user's saved home city. Open-Meteo is free + key-less so
  // failures degrade silently.
  const prefs = await getPrefs();
  const weatherCity = capsule.location?.trim() || prefs.homeCity || "";
  let weatherLine: string | null = null;
  if (weatherCity) {
    const f = await getForecast(weatherCity);
    if (f) weatherLine = describeForOutfit(f);
  }

  const dateNeededIso = capsule.dateNeeded
    ? capsule.dateNeeded.toISOString().slice(0, 10)
    : null;

  // Pack list hint to nudge variety: "3 tops, 4 bottoms…".
  const counts = parseTargetCounts(capsule.targetCounts);
  const packListHint = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${n} ${cat.toLowerCase()}`)
    .join(", ");

  const result = await provider.planTrip({
    destination: capsule.location ?? null,
    dateNeeded: dateNeededIso,
    weather: weatherLine,
    preferences: prefs.stylePreferences ?? undefined,
    packListHint: packListHint || undefined,
    targets,
    items: catalogItems.map((i) => ({
      id: i.id,
      category: i.category,
      subType: i.subType,
      color: i.color,
      brand: i.brand,
      seasons: csvToList(i.seasons),
      activities: csvToList(i.activities),
    })),
  });

  if (!result.outfits || result.outfits.length === 0) {
    return NextResponse.json(
      { enabled: true, outfits: [], error: result.debug?.error ?? "AI returned no outfits.", debug: result.debug },
      { status: 200 },
    );
  }

  // Persist the generated outfits as real Outfit rows linked back
  // to the capsule. The slot for each item is computed on save so
  // the regular outfit builder / style canvas works on them.
  const itemById = new Map(catalogItems.map((it) => [it.id, it]));

  if (replaceExisting) {
    await prisma.outfit.deleteMany({ where: { capsuleId: id, ownerId: userId } });
  }

  const created = [] as Array<{ id: string; name: string; activity: string }>;
  for (const o of result.outfits) {
    const validIds = o.itemIds.filter((iid) => itemById.has(iid));
    if (validIds.length === 0) continue;
    const outfit = await prisma.outfit.create({
      data: {
        ownerId: userId,
        name: o.name.slice(0, 80),
        activity: o.activity || null,
        season: capsule.season ?? null,
        capsuleId: id,
        items: {
          create: validIds.map((iid) => {
            const it = itemById.get(iid)!;
            return {
              itemId: iid,
              slot: slotForItem(it.category, it.subType),
            };
          }),
        },
      },
      select: { id: true, name: true, activity: true },
    });
    created.push({ id: outfit.id, name: outfit.name, activity: outfit.activity ?? "" });
  }

  return NextResponse.json({
    enabled: true,
    outfits: created,
    weather: weatherLine,
    debug: result.debug,
  });
}
