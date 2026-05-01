"use client";

import { useEffect, useRef, useState } from "react";
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
  tryOnImagePath: string | null;
};

// "Plan today's look".
//
// AI picks items from the closet (weather-aware when home city is set)
// and composites a dressed-mannequin try-on for the pick using the same
// Gemini Flash Image pipeline as the per-outfit Style page. Auto-fires
// once per morning when no saved pick exists for today; user can
// regenerate anytime via "✨ Try another".
export default function TodaysOutfitCard({
  homeCity,
  weatherSummary,
  initialPick,
  headUrl,
  headBBox,
}: {
  homeCity: string | null;
  weatherSummary: string | null;
  initialPick?: Suggestion | null;
  /** Optional stylized head overlay served via /api/uploads/. */
  headUrl?: string | null;
  /** Where to place the head on the try-on image, normalized 0..1. */
  headBBox?: { x: number; y: number; w: number; h: number } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(initialPick ?? null);
  const [error, setError] = useState<string | null>(null);
  // Pick + tryon together usually run 12-25s. Bump the time scale.
  const pickProgress = useTimedProgress(busy, 22);

  // Auto-fire on mount when there's nothing saved for today yet. Single-
  // shot per page mount, gated by autoFiredRef so a parent re-render
  // doesn't keep re-triggering.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (initialPick) return;
    autoFiredRef.current = true;
    // Don't await — let the card render its loading state immediately.
    pick(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPick]);

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
        tryOnImagePath: typeof data.tryOnImagePath === "string" ? data.tryOnImagePath : null,
      });
      haptic("success");
      // Surface compose-only failures as a non-blocking note — the user
      // still gets a valid outfit pick, just without the dressed render.
      if (data?.tryOnError) {
        setError(`Couldn't render the try-on: ${data.tryOnError}`);
      }
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

  const showHero = !!picked?.tryOnImagePath;

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

      {/* Dressed-mannequin hero when the try-on rendered successfully. */}
      {showHero && picked?.tryOnImagePath && (
        <div className="relative mt-4 mx-auto aspect-[1/2] max-h-[60vh] w-full overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${picked.tryOnImagePath}`}
            alt={picked.name ?? "Today's outfit"}
            className={"h-full w-full object-contain transition " + (busy ? "opacity-50" : "")}
          />
          {headUrl && headBBox && (
            // Stylized head overlay (CSS-stacked, no AI in the merge).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headUrl}
              alt=""
              aria-hidden
              draggable={false}
              className={"pointer-events-none absolute object-contain transition " + (busy ? "opacity-50" : "")}
              style={{
                left: `${headBBox.x * 100}%`,
                top: `${headBBox.y * 100}%`,
                width: `${headBBox.w * 100}%`,
                height: `${headBBox.h * 100}%`,
              }}
            />
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-white/40 text-sm text-stone-700">
              <div className="rounded-full bg-white/80 px-3 py-1.5 shadow-card">
                Picking + rendering…
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fallback tile grid when we have items but no try-on image (no
          mannequin set up, or the compose step failed). */}
      {!showHero && picked && picked.pickedItems.length > 0 && (
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
            label={picked ? "Picking your next look…" : "Picking + rendering your look…"}
            hint="usually 12–25s"
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
              className="btn-ghost text-blush-600"
            >
              {busy ? "…" : "✨ Try another"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
