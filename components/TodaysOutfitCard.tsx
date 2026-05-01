"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

type Suggestion = {
  itemIds: string[];
  pickedItems: PickedItem[];
  name: string | null;
  reasoning: string | null;
  weather: string | null;
};

// "Plan today's look".
//
// AI picks items from the closet (weather-aware when home city is set).
// Items render as a clean tile grid — when the user wants to see them on
// the mannequin, they save the outfit and visit the style canvas, where
// the new Gemini-based AI try-on composites the dressed mannequin.
export default function TodaysOutfitCard({
  homeCity,
  weatherSummary,
  initialPick,
}: {
  homeCity: string | null;
  weatherSummary: string | null;
  initialPick?: Suggestion | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(initialPick ?? null);
  const [error, setError] = useState<string | null>(null);
  const pickProgress = useTimedProgress(busy, 12);

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
      setPicked({
        itemIds: ids,
        pickedItems: enriched,
        name: data.name ?? null,
        reasoning: data.reasoning ?? null,
        weather: data.weather ?? null,
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
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {picked.pickedItems.map((it) => {
            const src = it.imageBgRemovedPath
              ? `/api/uploads/${it.imageBgRemovedPath}`
              : `/api/uploads/${it.imagePath}`;
            return (
              <div
                key={it.id}
                className="tile-bg flex aspect-square items-center justify-center rounded-xl bg-white/60 p-1 ring-1 ring-stone-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={it.subType ?? it.category}
                  className="h-full w-full object-contain"
                />
              </div>
            );
          })}
        </div>
      )}

      {picked && picked.reasoning && (
        <p className="mt-3 text-sm italic text-stone-600">&ldquo;{picked.reasoning}&rdquo;</p>
      )}

      {busy && (
        <div className="mt-3">
          <ProgressBar
            value={pickProgress}
            label={picked ? "Picking your next look…" : "Picking your look…"}
            hint="usually 5–15s"
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
              {busy ? "…" : "✨ Try another"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
