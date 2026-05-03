"use client";

import { useState } from "react";

type RetailerLink = {
  id: string;
  name: string;
  host: string;
  searchUrl: string;
};

type ShopIdea = {
  title: string;
  category: string | null;
  color: string | null;
  brandHint: string | null;
  priceTier: string | null;
  reasoning: string;
  searchQuery: string;
  retailers: RetailerLink[];
};

type ShopResponse = {
  enabled?: boolean;
  message?: string;
  error?: string;
  ideas?: ShopIdea[];
  weather?: {
    city: string;
    windowStart: string;
    windowEnd: string;
    highF: number;
    lowF: number;
    conditions: string;
    maxPrecipChance: number;
  } | null;
  targets?: Record<string, number>;
};

// Slider-driven AI shopping for a trip or themed collection. Reads
// the SAVED collection state on the server, builds a closet snapshot,
// pulls a forecast (when available), and asks Gemini for a curated
// shopping list. Each idea is shown with retailer search-page links
// the user can open in a new tab — and a "Save idea" button that drops
// the idea into the wishlist for later refinement.
export default function CollectionShop({
  collectionId,
  kind,
  destination,
  hasDates,
}: {
  collectionId: string;
  kind: "trip" | "general";
  destination: string | null;
  hasDates: boolean;
}) {
  const [intensity, setIntensity] = useState(50);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<ShopIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<ShopResponse["weather"] | null>(null);
  const [savedKey, setSavedKey] = useState<Record<string, "saving" | "saved" | "error">>(
    {},
  );

  async function search() {
    setBusy(true);
    setError(null);
    setIdeas(null);
    setWeather(null);
    setSavedKey({});
    try {
      const res = await fetch("/api/ai/collection-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, intensity }),
      });
      const data = (await res.json()) as ShopResponse;
      if (data.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setIdeas(data.ideas ?? []);
      setWeather(data.weather ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the AI service.");
    } finally {
      setBusy(false);
    }
  }

  async function saveIdea(idea: ShopIdea) {
    const key = idea.searchQuery;
    setSavedKey((prev) => ({ ...prev, [key]: "saving" }));
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: idea.title,
          brand: idea.brandHint ?? undefined,
          category: idea.category ?? undefined,
          // Use the first retailer's search URL as a starting link.
          // The user can refine to a specific product after browsing.
          link: idea.retailers[0]?.searchUrl,
          notes: idea.reasoning || undefined,
          priority: "medium",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedKey((prev) => ({ ...prev, [key]: "saved" }));
    } catch {
      setSavedKey((prev) => ({ ...prev, [key]: "error" }));
    }
  }

  const intensityLabel =
    intensity <= 20
      ? "Stay in my lane"
      : intensity <= 45
        ? "Mostly familiar"
        : intensity <= 65
          ? "Balanced"
          : intensity <= 85
            ? "Lean exploratory"
            : "Show me new aesthetics";

  const tripPrompt = kind === "trip"
    ? destination
      ? `pieces for ${destination}${hasDates ? "" : " (add dates for a live forecast)"}`
      : "pieces for this trip (add a destination for weather-aware picks)"
    : "pieces that fit this collection's vibe";

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-display text-xl text-stone-800">✨ Shop for this {kind === "trip" ? "trip" : "collection"}</h2>
        <p className="text-sm text-stone-500">
          AI suggests new {tripPrompt} and gives you retailer search links to
          start exploring. Adjust the slider to control how closely results match
          your closet.
        </p>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="closet-intensity" className="label">Closet awareness</label>
          <span className="text-xs text-stone-500">{intensityLabel}</span>
        </div>
        <input
          id="closet-intensity"
          type="range"
          min={0}
          max={100}
          step={5}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="w-full accent-blush-500"
          disabled={busy}
        />
        <div className="mt-1 flex justify-between text-[11px] text-stone-400">
          <span>Stay close to my style</span>
          <span>Find me something new</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={search}
          className="btn-primary"
          disabled={busy}
        >
          {busy ? "Asking the AI…" : ideas ? "✨ Refresh ideas" : "✨ Find new pieces"}
        </button>
        <p className="text-xs text-stone-500">
          Tap a retailer to search there — or save the idea to your wishlist.
        </p>
      </div>

      {weather && (
        <p className="rounded-2xl bg-cream-50 px-3 py-2 text-xs text-stone-700">
          🌤 {weather.city}, {weather.windowStart}
          {weather.windowEnd !== weather.windowStart ? `–${weather.windowEnd}` : ""}: {weather.lowF}°F–{weather.highF}°F, {weather.conditions}
          {weather.maxPrecipChance >= 40 ? `, up to ${weather.maxPrecipChance}% rain chance` : ""}
        </p>
      )}

      {error && (
        <p className="whitespace-pre-line rounded-2xl bg-blush-50 px-3 py-2 text-sm text-blush-800">
          {error}
        </p>
      )}

      {busy && !ideas && (
        <p className="text-sm text-stone-500">
          Reading your closet, checking the forecast, and asking Gemini for shopping ideas. Usually 5–10 seconds.
        </p>
      )}

      {ideas && ideas.length === 0 && !busy && (
        <p className="text-sm text-stone-500">
          No ideas came back — try a different intensity or fill in more trip details.
        </p>
      )}

      {ideas && ideas.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ideas.map((idea) => {
            const status = savedKey[idea.searchQuery];
            return (
              <li key={idea.searchQuery} className="card flex flex-col gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-display text-base text-stone-800">{idea.title}</p>
                  <p className="truncate text-[11px] uppercase tracking-wide text-stone-400">
                    {[idea.category, idea.color, idea.priceTier]
                      .filter(Boolean)
                      .join(" · ") || ""}
                    {idea.brandHint ? (
                      <>
                        {[idea.category, idea.color, idea.priceTier].filter(Boolean).length > 0 ? " · " : ""}
                        {idea.brandHint}
                      </>
                    ) : null}
                  </p>
                </div>

                {idea.reasoning && (
                  <p className="text-sm text-stone-700">{idea.reasoning}</p>
                )}

                {idea.retailers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {idea.retailers.map((r) => (
                      <a
                        key={r.id}
                        href={r.searchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-700 transition hover:border-blush-300 hover:bg-blush-50 hover:text-blush-800"
                        title={`Search ${r.name} for "${idea.searchQuery}"`}
                      >
                        Search {r.name} ↗
                      </a>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => saveIdea(idea)}
                    disabled={status === "saving" || status === "saved"}
                    className="btn-secondary text-xs disabled:opacity-60"
                  >
                    {status === "saved"
                      ? "✓ Saved"
                      : status === "saving"
                        ? "Saving…"
                        : status === "error"
                          ? "Retry"
                          : "+ Save idea"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
