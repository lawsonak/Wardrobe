"use client";

import { useEffect, useRef, useState } from "react";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";
import type { SavedSuggestion } from "@/lib/todaysSuggestion";

// "Today's suggestion" — a single AI-picked product the user might
// like, hyperlinked to the vendor's product page. Strictly user-
// initiated: the card sits idle with a "Suggest a piece" button until
// the user taps it. We keep whatever's saved for today so the card
// paints instantly on revisit, but never fires AI on its own.
export default function TodaysSuggestionCard({
  initialSaved,
}: {
  initialSaved: SavedSuggestion | null;
}) {
  const [saved, setSaved] = useState<SavedSuggestion | null>(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same stall-detection pattern as TodaysOutfitCard: surface a
  // Cancel option after 35s so a wedged request isn't a dead end.
  const [stillWaiting, setStillWaiting] = useState(false);
  const progress = useTimedProgress(busy, 12);
  const abortRef = useRef<AbortController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    };
  }, []);

  function cancel() {
    abortRef.current?.abort();
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    setBusy(false);
    setStillWaiting(false);
  }

  async function fetchNext(again: boolean) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setStillWaiting(false);
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => setStillWaiting(true), 35_000);
    try {
      const res = await fetch("/api/ai/style-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ again }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? `Suggestion failed (HTTP ${res.status}).`);
        return;
      }
      if (data?.saved) {
        setSaved(data.saved as SavedSuggestion);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't reach the AI.");
    } finally {
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      setBusy(false);
      setStillWaiting(false);
    }
  }

  function StillWaiting() {
    if (!stillWaiting) return null;
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
        <span>Taking longer than usual. You can cancel and try again later.</span>
        <button
          type="button"
          onClick={cancel}
          className="rounded-full bg-white px-2 py-1 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-blush-600">Today&apos;s suggestion</p>
        {saved && (
          <button
            type="button"
            onClick={() => fetchNext(true)}
            disabled={busy}
            className="btn-ghost text-xs text-blush-600"
          >
            {busy ? "…" : "✨ Try another"}
          </button>
        )}
      </div>

      {!saved && busy && (
        <div className="mt-3 space-y-2">
          <ProgressBar
            value={progress}
            label="Reading your closet…"
            hint="usually 5–15s"
          />
          <StillWaiting />
        </div>
      )}

      {!saved && !busy && !error && (
        <button
          type="button"
          onClick={() => fetchNext(false)}
          className="btn-primary mt-3"
        >
          ✨ Suggest a piece
        </button>
      )}

      {saved && (
        <div className="mt-2">
          {saved.vendor && (
            <p className="text-xs text-stone-500">{saved.vendor}</p>
          )}
          <h2 className="font-display text-xl text-stone-800">
            <a
              href={saved.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blush-700 underline decoration-blush-200 underline-offset-2 hover:decoration-blush-500"
            >
              {saved.productName}
              <span className="ml-1 text-stone-400" aria-hidden>↗</span>
            </a>
          </h2>
          <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-stone-500">
            {saved.category && <span>{saved.category}</span>}
            {saved.estimatedPrice && (
              <>
                {saved.category && <span aria-hidden>·</span>}
                <span>{saved.estimatedPrice}</span>
              </>
            )}
          </div>
          {saved.reasoning && (
            <p className="mt-2 text-sm italic text-stone-600">&ldquo;{saved.reasoning}&rdquo;</p>
          )}
          {busy && (
            <div className="mt-3 space-y-2">
              <ProgressBar
                value={progress}
                label="Looking for another option…"
                hint="usually 5–15s"
              />
              <StillWaiting />
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-blush-700">{error}</p>}
    </section>
  );
}
