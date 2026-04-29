"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

type Suggestion = {
  itemIds: string[];
  name?: string;
  reasoning?: string;
  weather?: string | null;
};

// One-tap outfit-of-the-day card. Calls the existing /api/ai/outfit
// endpoint with a date+weather-flavored prompt; the user can save with
// a click. Only fires AI when the user opts in (button click) so the
// dashboard stays cheap and snappy.
export default function TodaysOutfitCard({
  homeCity,
  weatherSummary,
}: {
  homeCity: string | null;
  weatherSummary: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(again = false) {
    setBusy(true);
    setError(null);
    try {
      const day = new Date().toLocaleDateString(undefined, { weekday: "long" });
      const occasion = again ? `Outfit for ${day} (try another)` : `Outfit for ${day}`;
      const res = await fetch("/api/ai/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occasion }),
      });
      const data = await res.json();
      if (data?.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      const ids = (data.itemIds ?? []) as string[];
      if (ids.length === 0) {
        setError(data?.debug?.error ?? "Couldn't pick an outfit.");
        return;
      }
      setPicked({
        itemIds: ids,
        name: data.name,
        reasoning: data.reasoning,
        weather: data.weather,
      });
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

  async function markWornAndOpen() {
    if (!picked) return;
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

      {error && <p className="mt-3 text-xs text-blush-700">{error}</p>}

      {picked && picked.reasoning && (
        <p className="mt-3 text-sm italic text-stone-600">&ldquo;{picked.reasoning}&rdquo;</p>
      )}

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
