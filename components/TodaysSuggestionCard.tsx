"use client";

import { useEffect, useRef, useState } from "react";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";
import { CATEGORIES, BEAUTY_CATEGORY_GROUPS } from "@/lib/constants";
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
  // Optional constraints — both default empty so the original
  // open-ended "Suggest a piece" tap behaves the same way it did
  // before. When either is set, the server prompt pins the
  // suggestion to that category / phrase.
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState<string>("");
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
        body: JSON.stringify({
          again,
          // Send only when filled so the server's "no constraints"
          // codepath stays clean for the empty-inputs case.
          category: category || undefined,
          query: query.trim() || undefined,
        }),
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

      {/* Optional constraints — visible in all states so a user can
          tweak between "Try another" taps. Leave both blank for the
          open-ended pick. Hidden while a request is in flight to
          discourage editing mid-fetch. */}
      {!busy && (
        <div className="mt-3">
          <ConstraintInputs
            category={category}
            setCategory={setCategory}
            query={query}
            setQuery={setQuery}
            busy={busy}
          />
        </div>
      )}

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

// Tiny inline form for the optional category + free-text constraints.
// Both inputs are unrequired — submitting with both empty produces
// the same open-ended suggestion as before.
function ConstraintInputs({
  category,
  setCategory,
  query,
  setQuery,
  busy,
}: {
  category: string;
  setCategory: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={busy}
        className="input w-auto text-xs sm:flex-shrink-0"
        aria-label="Category (optional)"
      >
        <option value="">Any category</option>
        {/* Clothing first — the dominant vocabulary. Wrapped in an
            optgroup so it visually pairs with the beauty groups
            below. */}
        <optgroup label="Clothing">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </optgroup>
        {/* Beauty groups (Lips / Eyes / Face / Skincare / Tools /
            Fragrance) — the suggestion API accepts any beauty
            category and the Gemini grounded-search prompt will
            surface a real cosmetic product when one of these is
            picked. */}
        {BEAUTY_CATEGORY_GROUPS.map((g) => (
          <optgroup key={g.label} label={`💄 ${g.label}`}>
            {g.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        placeholder="Looking for something specific? (optional)"
        className="input flex-1 text-xs"
        aria-label="What you're looking for (optional)"
        maxLength={200}
      />
    </div>
  );
}
