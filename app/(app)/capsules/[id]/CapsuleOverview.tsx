"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import PlanTripButton from "./PlanTripButton";
import type { ActivityTarget, TargetCounts } from "@/lib/capsulePlan";

type OverviewItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type OverviewOutfit = {
  id: string;
  name: string;
  activity: string | null;
  thumbs: Array<{ id: string; src: string }>;
};

type WeatherSummary = {
  city: string;
  country: string | null;
  tempF: number;
  highF: number;
  lowF: number;
  conditions: string;
  precipChance: number;
};

// Read-first capsule view. Mirrors the wardrobe-item pattern: this
// page is the cohesive "what's in this collection" overview; the
// busy edit form lives behind ?edit=1 and is reached via the Edit
// button up top.
export default function CapsuleOverview({
  capsuleId,
  name,
  occasion,
  season,
  description,
  dateNeeded,
  location,
  weather,
  targetCounts,
  activityTargets,
  fulfilledByCategory,
  fulfilledByActivity,
  totalItems,
  totalTarget,
  items,
  outfits,
  hasTripPlan,
}: {
  capsuleId: string;
  name: string;
  occasion: string | null;
  season: string | null;
  description: string | null;
  dateNeeded: string | null;
  location: string | null;
  weather: WeatherSummary | null;
  targetCounts: TargetCounts;
  activityTargets: ActivityTarget[];
  fulfilledByCategory: Record<string, number>;
  fulfilledByActivity: Record<string, number>;
  totalItems: number;
  totalTarget: number;
  items: OverviewItem[];
  outfits: OverviewOutfit[];
  hasTripPlan: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [packOpen, setPackOpen] = useState(false);

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      body: "The pieces stay in your closet — only this collection is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/capsules/${capsuleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      haptic("success");
      toast("Collection deleted");
      router.push("/capsules");
      router.refresh();
    } catch {
      toast("Couldn't delete", "error");
      setBusy(false);
    }
  }

  // One-line summary for the trip header — date · city · weather.
  const tripLine = [
    dateNeeded
      ? new Date(dateNeeded).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null,
    location,
    weather ? `${weather.tempF}°F ${weather.conditions}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const subtitle = [occasion, season].filter(Boolean).join(" · ");
  const showPackProgress = totalTarget > 0;
  const packDone = totalTarget > 0 && totalItems >= totalTarget;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/capsules" className="text-sm text-blush-600 hover:underline">
            ← Collections
          </Link>
          <h1 className="mt-1 truncate font-display text-3xl text-blush-700">{name}</h1>
          {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
        </div>
        <Link
          href={`/capsules/${capsuleId}?edit=1`}
          className="btn-secondary shrink-0 text-xs"
          aria-label="Edit collection"
        >
          ✎ Edit
        </Link>
      </div>

      {description && (
        <p className="text-sm text-stone-600 whitespace-pre-wrap">{description}</p>
      )}

      {/* ── Trip line + AI plan + pack progress ─────────────────── */}
      {hasTripPlan && (
        <section className="card space-y-3 p-4">
          {tripLine && (
            <p className="text-sm text-stone-700">{tripLine}</p>
          )}
          {weather && (weather.precipChance >= 40) && (
            <p className="text-xs text-stone-500">
              {weather.precipChance}% chance of rain · {weather.lowF}°-{weather.highF}°F today
            </p>
          )}

          {showPackProgress && (
            <div>
              <button
                type="button"
                onClick={() => setPackOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={packOpen}
              >
                <span className={"text-sm font-medium " + (packDone ? "text-blush-700" : "text-stone-700")}>
                  {totalItems} / {totalTarget} pieces packed
                </span>
                <span className="text-xs text-stone-400">{packOpen ? "Hide" : "Breakdown"}</span>
              </button>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full bg-blush-500 transition-all"
                  style={{
                    width: `${Math.min(100, Math.round((totalItems / totalTarget) * 100))}%`,
                  }}
                />
              </div>
              {packOpen && (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {Object.entries(targetCounts).map(([cat, target]) => {
                    const have = fulfilledByCategory[cat] ?? 0;
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
              )}
            </div>
          )}

          {activityTargets.length > 0 && (
            <div className="space-y-2">
              <ul className="space-y-1 text-sm text-stone-600">
                {activityTargets.map((t, i) => {
                  const got = fulfilledByActivity[t.activity] ?? 0;
                  return (
                    <li key={i} className="flex items-center justify-between">
                      <span>
                        {t.label}{" "}
                        <span className="text-xs text-stone-400">({t.activity})</span>
                      </span>
                      <span className={got >= t.count ? "text-blush-600" : "text-stone-500"}>
                        {got} / {t.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <PlanTripButton
                capsuleId={capsuleId}
                hasExistingOutfits={outfits.length > 0}
              />
            </div>
          )}
        </section>
      )}

      {/* ── Generated outfits ───────────────────────────────────── */}
      {outfits.length > 0 && (
        <section>
          <p className="label mb-2">Outfits in this collection</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {outfits.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/outfits/${o.id}/style`}
                  className="card flex items-center gap-3 p-2 transition hover:shadow-md"
                >
                  <div className="flex shrink-0 gap-1">
                    {o.thumbs.slice(0, 4).map((t) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={t.id}
                        src={t.src}
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

      {/* ── Items grid ──────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="label mb-0">
            Pieces ({items.length})
          </p>
          <Link href={`/capsules/${capsuleId}?edit=1`} className="text-xs text-blush-600 hover:underline">
            Add or remove pieces
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="card p-6 text-center text-sm text-stone-500">
            No pieces yet. Tap <span className="font-medium">✎ Edit</span> to choose some.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {items.map((it) => {
              const src = it.imageBgRemovedPath
                ? `/api/uploads/${it.imageBgRemovedPath}`
                : `/api/uploads/${it.imagePath}`;
              return (
                <li key={it.id}>
                  <Link
                    href={`/wardrobe/${it.id}`}
                    className="tile-bg block aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-stone-100 transition hover:ring-2 hover:ring-blush-300"
                    title={it.subType ?? it.category}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={it.subType ?? it.category}
                      className="h-full w-full object-contain p-2"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="border-t border-stone-100 pt-3 text-center">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs text-stone-400 hover:text-blush-700"
        >
          Delete collection
        </button>
      </div>
    </div>
  );
}
