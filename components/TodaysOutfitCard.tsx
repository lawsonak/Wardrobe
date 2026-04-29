"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import OutfitMiniCanvas from "@/components/OutfitMiniCanvas";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";
import { haptic } from "@/lib/haptics";

type PickedItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type Suggestion = {
  itemIds: string[];
  pickedItems: PickedItem[];
  name: string | null;
  reasoning: string | null;
  weather: string | null;
};

// "Plan today's look".
//
// Lifecycle:
//   - The dashboard server-loads any saved pick for today and passes
//     it as `initialPick`. So returning to the dashboard shows the
//     same outfit until the calendar day rolls over (the JSON file
//     auto-expires by date inside readSavedPick).
//   - When `initialPick` is present, we still kick off the AI
//     compose ("polish") in the background. The polish endpoint
//     caches by item-set hash, so repeated mounts are free.
//   - "Try another" calls POST /api/ai/outfit/today which picks
//     fresh and overwrites the saved pick.
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
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);

  // On mount, if we already have a saved pick, polish it (cached).
  useEffect(() => {
    if (initialPick && initialPick.itemIds.length > 0 && mannequinSrc) {
      void polishOutfit(initialPick.itemIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(again = false) {
    setBusy(true);
    setError(null);
    setRenderedSrc(null);
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
      setPicked({
        itemIds: ids,
        pickedItems: enriched,
        name: data.name ?? null,
        reasoning: data.reasoning ?? null,
        weather: data.weather ?? null,
      });
      haptic("success");
      void polishOutfit(ids);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Today's outfit failed.");
    } finally {
      setBusy(false);
    }
  }

  async function polishOutfit(itemIds: string[]) {
    if (!mannequinSrc) return; // No mannequin → no polish step.
    setPolishing(true);
    try {
      const res = await fetch("/api/ai/render-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.url) return;
      setRenderedSrc(data.url as string);
      haptic("tap");
    } catch {
      /* silent — overlay stays visible */
    } finally {
      setPolishing(false);
    }
  }

  function openInBuilder() {
    if (!picked) return;
    const params = new URLSearchParams({ ids: picked.itemIds.join(",") });
    if (picked.name) params.set("name", picked.name);
    router.push(`/outfits/builder?${params.toString()}`);
  }

  async function markWornAndOpen() {
    if (!picked) return;
    haptic("tap");
    try {
      await Promise.all(
        picked.itemIds.map((id) =>
          fetch(`/api/items/${id}/wear`, { method: "POST" }).catch(() => null),
        ),
      );
      toast("Marked these as worn today");
    } catch {
      /* ignore */
    }
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
        <div className="mt-4 flex flex-col items-center">
          <div className="relative w-full max-w-[14rem]">
            <OutfitMiniCanvas
              items={picked.pickedItems}
              mannequinSrc={mannequinSrc}
              landmarks={landmarks}
              renderedSrc={renderedSrc}
              className="w-full"
            />
            {polishing && !renderedSrc && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-white/85 px-3 py-1 text-[11px] text-stone-600 shadow-card ring-1 ring-stone-100 backdrop-blur">
                ✨ Polishing the look…
              </div>
            )}
          </div>
        </div>
      )}

      {picked && picked.reasoning && (
        <p className="mt-3 text-sm italic text-stone-600">&ldquo;{picked.reasoning}&rdquo;</p>
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
            <button type="button" onClick={markWornAndOpen} className="btn-secondary">
              👕 Wearing it
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
