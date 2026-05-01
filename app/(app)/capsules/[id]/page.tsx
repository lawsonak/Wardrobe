import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CapsuleEditor, { type Selectable } from "../CapsuleEditor";
import CapsuleOverview from "./CapsuleOverview";
import { parseActivityTargets, parseTargetCounts } from "@/lib/capsulePlan";
import { cToF, getForecast } from "@/lib/weather";

export const dynamic = "force-dynamic";

export default async function CapsuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const editing = sp.edit === "1";

  const capsule = await prisma.capsule.findFirst({
    where: { id, ownerId: userId },
    include: {
      items: { include: { item: true } },
      outfits: {
        orderBy: { createdAt: "desc" },
        include: { items: { include: { item: true } } },
      },
    },
  });
  if (!capsule) notFound();

  const targetCounts = parseTargetCounts(capsule.targetCounts);
  const activityTargets = parseActivityTargets(capsule.activityTargets);
  const dateNeededIso = capsule.dateNeeded
    ? capsule.dateNeeded.toISOString().slice(0, 10)
    : null;
  const hasTripPlan =
    !!capsule.dateNeeded ||
    !!capsule.location ||
    Object.keys(targetCounts).length > 0 ||
    activityTargets.length > 0;

  // ── Edit mode ────────────────────────────────────────────────
  if (editing) {
    const items = await prisma.item.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
    });

    const selectable: Selectable[] = items.map((i) => ({
      id: i.id,
      imagePath: i.imagePath,
      imageBgRemovedPath: i.imageBgRemovedPath,
      category: i.category,
      subType: i.subType,
      brand: i.brand,
      isFavorite: i.isFavorite,
      seasons: i.seasons,
      activities: i.activities,
    }));

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/capsules/${capsule.id}`}
            className="text-sm text-blush-600 hover:underline"
          >
            ← Done editing
          </Link>
          <p className="text-xs uppercase tracking-wide text-stone-500">Edit mode</p>
        </div>
        <CapsuleEditor
          capsule={{
            id: capsule.id,
            name: capsule.name,
            description: capsule.description,
            occasion: capsule.occasion,
            season: capsule.season,
            dateNeeded: dateNeededIso,
            location: capsule.location,
            targetCounts,
            activityTargets,
            itemIds: capsule.items.map((ci) => ci.itemId),
          }}
          items={selectable}
          mode="edit"
          cancelHref={`/capsules/${capsule.id}`}
          tripPlanInitiallyOpen={hasTripPlan}
        />
      </div>
    );
  }

  // ── Read-only overview ───────────────────────────────────────
  const fulfilledByCategory: Record<string, number> = {};
  for (const ci of capsule.items) {
    fulfilledByCategory[ci.item.category] =
      (fulfilledByCategory[ci.item.category] ?? 0) + 1;
  }
  const fulfilledByActivity: Record<string, number> = {};
  for (const o of capsule.outfits) {
    if (!o.activity) continue;
    fulfilledByActivity[o.activity] = (fulfilledByActivity[o.activity] ?? 0) + 1;
  }
  const totalItems = capsule.items.length;
  const totalTarget = Object.values(targetCounts).reduce((sum, n) => sum + n, 0);

  // Tiny weather hint for the trip card. Free / keyless — degrades silently.
  const forecast = capsule.location ? await getForecast(capsule.location) : null;
  const weather = forecast
    ? {
        city: forecast.city,
        country: forecast.country,
        tempF: cToF(forecast.tempC),
        highF: cToF(forecast.highC),
        lowF: cToF(forecast.lowC),
        conditions: forecast.conditions,
        precipChance: forecast.precipChance,
      }
    : null;

  const overviewItems = capsule.items.map((ci) => ({
    id: ci.item.id,
    imagePath: ci.item.imagePath,
    imageBgRemovedPath: ci.item.imageBgRemovedPath,
    category: ci.item.category,
    subType: ci.item.subType,
  }));

  const overviewOutfits = capsule.outfits.map((o) => ({
    id: o.id,
    name: o.name,
    activity: o.activity,
    thumbs: o.items.slice(0, 4).map((oi) => ({
      id: oi.item.id,
      src: oi.item.imageBgRemovedPath
        ? `/api/uploads/${oi.item.imageBgRemovedPath}`
        : `/api/uploads/${oi.item.imagePath}`,
    })),
  }));

  return (
    <CapsuleOverview
      capsuleId={capsule.id}
      name={capsule.name}
      occasion={capsule.occasion}
      season={capsule.season}
      description={capsule.description}
      dateNeeded={dateNeededIso}
      location={capsule.location}
      weather={weather}
      targetCounts={targetCounts}
      activityTargets={activityTargets}
      fulfilledByCategory={fulfilledByCategory}
      fulfilledByActivity={fulfilledByActivity}
      totalItems={totalItems}
      totalTarget={totalTarget}
      items={overviewItems}
      outfits={overviewOutfits}
      hasTripPlan={hasTripPlan}
    />
  );
}
