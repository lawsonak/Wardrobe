import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CapsuleEditor, { type Selectable } from "../CapsuleEditor";
import {
  parseActivityTargets,
  parseTargetCounts,
} from "@/lib/capsulePlan";
import { describeForOutfit, getForecast } from "@/lib/weather";
import PlanTripButton from "./PlanTripButton";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

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

  const targetCounts = parseTargetCounts(capsule.targetCounts);
  const activityTargets = parseActivityTargets(capsule.activityTargets);

  // Fulfilled-vs-target tally. Counts the capsule's items by category
  // so the user can see "3 / 3 tops, 1 / 4 bottoms".
  const fulfilled: Record<string, number> = {};
  for (const ci of capsule.items) {
    fulfilled[ci.item.category] = (fulfilled[ci.item.category] ?? 0) + 1;
  }

  // Optional weather glance for the trip card. Only fetched when the
  // user provided a location — Open-Meteo is keyless and degrades silently.
  const forecast = capsule.location ? await getForecast(capsule.location) : null;
  const dateNeededDate = capsule.dateNeeded ?? null;

  const hasTripPlan =
    !!capsule.dateNeeded ||
    !!capsule.location ||
    Object.keys(targetCounts).length > 0 ||
    activityTargets.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/capsules" className="text-sm text-blush-600 hover:underline">
          ← Collections
        </Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{capsule.name}</h1>
        <p className="text-sm text-stone-500">
          {[capsule.occasion, capsule.season].filter(Boolean).join(" · ") ||
            "Edit pieces, occasion, and season."}
        </p>
      </div>

      {/* ── Trip overview ───────────────────────────────────────── */}
      {hasTripPlan && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-lg text-stone-800">Trip plan</p>
            {dateNeededDate && (
              <p className="text-xs text-stone-500">
                {formatDate(dateNeededDate)}
                {capsule.location ? ` · ${capsule.location}` : ""}
              </p>
            )}
          </div>

          {forecast && (
            <p className="text-xs text-stone-500">{describeForOutfit(forecast)}</p>
          )}

          {/* Pack-list progress */}
          {Object.keys(targetCounts).length > 0 && (
            <div>
              <p className="label mb-1">Pack list</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {Object.entries(targetCounts).map(([cat, target]) => {
                  const have = fulfilled[cat] ?? 0;
                  const done = have >= target;
                  return (
                    <li
                      key={cat}
                      className={
                        "rounded-full px-2 py-0.5 ring-1 " +
                        (done
                          ? "bg-blush-50 text-blush-700 ring-blush-200"
                          : "bg-cream-50 text-stone-600 ring-stone-200")
                      }
                    >
                      {cat}: {have} / {target}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Outfit targets */}
          {activityTargets.length > 0 && (
            <div>
              <p className="label mb-1">Outfit targets</p>
              <ul className="space-y-1 text-xs text-stone-600">
                {activityTargets.map((t, i) => {
                  const got = capsule.outfits.filter((o) => o.activity === t.activity).length;
                  return (
                    <li key={i} className="flex items-center justify-between">
                      <span>
                        {t.label}{" "}
                        <span className="text-stone-400">({t.activity})</span>
                      </span>
                      <span className={got >= t.count ? "text-blush-600" : "text-stone-500"}>
                        {got} / {t.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activityTargets.length > 0 && (
            <PlanTripButton
              capsuleId={capsule.id}
              hasExistingOutfits={capsule.outfits.length > 0}
            />
          )}
        </section>
      )}

      {/* ── Generated outfits ───────────────────────────────────── */}
      {capsule.outfits.length > 0 && (
        <section className="card p-4">
          <p className="label mb-2">Outfits in this collection</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {capsule.outfits.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/outfits/${o.id}/style`}
                  className="card flex items-center gap-3 p-2 transition hover:shadow-md"
                >
                  <div className="flex shrink-0 gap-1">
                    {o.items.slice(0, 4).map((oi) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={oi.id}
                        src={
                          oi.item.imageBgRemovedPath
                            ? `/api/uploads/${oi.item.imageBgRemovedPath}`
                            : `/api/uploads/${oi.item.imagePath}`
                        }
                        alt=""
                        className="h-10 w-10 rounded-md bg-cream-50 object-contain p-1 ring-1 ring-stone-100"
                      />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-stone-800">{o.name}</p>
                    {o.activity && (
                      <p className="text-xs text-stone-500">{o.activity}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Editor ──────────────────────────────────────────────── */}
      <CapsuleEditor
        capsule={{
          id: capsule.id,
          name: capsule.name,
          description: capsule.description,
          occasion: capsule.occasion,
          season: capsule.season,
          dateNeeded: capsule.dateNeeded
            ? capsule.dateNeeded.toISOString().slice(0, 10)
            : null,
          location: capsule.location,
          targetCounts,
          activityTargets,
          itemIds: capsule.items.map((ci) => ci.itemId),
        }}
        items={selectable}
        mode="edit"
      />
    </div>
  );
}
