"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OutfitMiniCanvas from "@/components/OutfitMiniCanvas";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";
import { haptic } from "@/lib/haptics";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";

type PickedItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type LayoutEntry = {
  itemId: string;
  x: number;
  y: number;
  w: number;
  rotation: number;
};

type Suggestion = {
  itemIds: string[];
  pickedItems: PickedItem[];
  name: string | null;
  reasoning: string | null;
  weather: string | null;
  /** Serialized {layers:[…]} JSON forwarded to OutfitMiniCanvas. */
  layoutJson: string | null;
};

// Build a layoutJson string from the AI fit result.
function layoutToJson(layout: LayoutEntry[]): string | null {
  if (!layout || layout.length === 0) return null;
  const layers = layout.map((l, idx) => ({
    id: l.itemId,
    x: l.x,
    y: l.y,
    w: l.w,
    rotation: l.rotation,
    z: 4 + idx * 0.001,
    hidden: false,
  }));
  return JSON.stringify({ layers });
}

// "Plan today's look".
//
// AI picks the items from the closet, then asks AI again for per-item
// placement on the user's mannequin. Mannequin pixels are never
// touched — we just render the items via the calibrated landmark
// overlay using the AI-computed positions when available, falling
// back to slot defaults otherwise. The pick + layout are server-
// persisted; reloads paint instantly with no extra AI calls.
export default function TodaysOutfitCard({
  homeCity,
  weatherSummary,
  mannequinSrc,
  landmarks,
  initialPick,
}: {
  homeCity: string | null;
  weatherSummary: string | null;
  mannequinSrc: string | null;
  landmarks: Landmarks | null;
  initialPick?: Suggestion | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(initialPick ?? null);
  const [error, setError] = useState<string | null>(null);
  // Pick + AI fit pass take ~25-35s combined.
  const pickProgress = useTimedProgress(busy, 30);

  async function pick(again = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/outfit/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ again }),
      });
      const data = await res.json();
      if (data?.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      const ids = (data.itemIds ?? []) as string[];
      const enriched = (data.pickedItems ?? []) as PickedItem[];
      if (ids.length === 0) {
        setError(data?.debug?.error ?? "Couldn't pick an outfit.");
        return;
      }
      const layout = (data.layout ?? null) as LayoutEntry[] | null;
      setPicked({
        itemIds: ids,
        pickedItems: enriched,
        name: data.name ?? null,
        reasoning: data.reasoning ?? null,
        weather: data.weather ?? null,
        layoutJson: layout ? layoutToJson(layout) : null,
      });
      haptic("success");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Today's outfit failed.");
    } finally {
      setBusy(false);
    }
  }

  function openInBuilder() {
    if (!picked) return;
    const params = new URLSearchParams({ ids: picked.itemIds.join(",") });
    if (picked.name) params.set("name", picked.name);
    router.push(`/outfits/builder?${params.toString()}`);
  }

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-blush-600">Today&apos;s outfit</p>
          <h2 className="mt-0.5 truncate font-display text-xl text-stone-800">
            {picked?.name ?? (busy ? "Picking your look…" : "Plan today's look")}
          </h2>
          {weatherSummary && (
            <p className="mt-1 text-xs text-stone-500">{weatherSummary}</p>
          )}
          {!homeCity && (
            <p className="mt-1 text-xs text-stone-400">
              Set a home city in Settings to factor in the weather.
            </p>
          )}
        </div>
      </div>

      {picked && picked.pickedItems.length > 0 && (
        <div className="mt-4 flex justify-center">
          <OutfitMiniCanvas
            items={picked.pickedItems}
            mannequinSrc={mannequinSrc}
            landmarks={landmarks}
            layoutJson={picked.layoutJson}
            className="w-full max-w-[14rem]"
          />
        </div>
      )}

      {picked && picked.reasoning && (
        <p className="mt-3 text-sm italic text-stone-600">&ldquo;{picked.reasoning}&rdquo;</p>
      )}

      {busy && (
        <div className="mt-3">
          <ProgressBar
            value={pickProgress}
            label={picked ? "Picking your next look…" : "Picking + fitting your look…"}
            hint="usually 20–40s"
          />
        </div>
      )}

      {error && <p className="mt-3 text-xs text-blush-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!picked ? (
          <button type="button" onClick={() => pick(false)} disabled={busy} className="btn-primary">
            {busy ? "Picking…" : "✨ Pick today's outfit"}
          </button>
        ) : (
          <>
            <button type="button" onClick={openInBuilder} className="btn-primary">
              Open in Builder
            </button>
            <button
              type="button"
              onClick={() => pick(true)}
              disabled={busy}
              className="btn-ghost text-stone-500"
            >
              {busy ? "…" : "Try another"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
