"use client";

import { useState } from "react";

type ShopProduct = {
  productName: string;
  brand: string | null;
  vendor: string | null;
  productUrl: string;
  category: string | null;
  color: string | null;
  estimatedPrice: string | null;
  reasoning: string;
  imageUrl: string | null;
};

type ShopResponse = {
  enabled?: boolean;
  message?: string;
  error?: string;
  products?: ShopProduct[];
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
// pulls a forecast (when available), and asks Gemini's grounded search
// for a list of real products. Each result has its own "Add to wishlist"
// button that wires straight to /api/wishlist with the prefilled fields.
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
  const [products, setProducts] = useState<ShopProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<ShopResponse["weather"] | null>(null);
  const [added, setAdded] = useState<Record<string, "saving" | "added" | "error">>({});

  async function search() {
    setBusy(true);
    setError(null);
    setProducts(null);
    setWeather(null);
    setAdded({});
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
      setProducts(data.products ?? []);
      setWeather(data.weather ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the AI service.");
    } finally {
      setBusy(false);
    }
  }

  async function addToWishlist(p: ShopProduct) {
    setAdded((prev) => ({ ...prev, [p.productUrl]: "saving" }));
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.productName,
          brand: p.brand ?? undefined,
          category: p.category ?? undefined,
          link: p.productUrl,
          price: p.estimatedPrice ?? undefined,
          notes: p.reasoning || undefined,
          priority: "medium",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdded((prev) => ({ ...prev, [p.productUrl]: "added" }));
    } catch {
      setAdded((prev) => ({ ...prev, [p.productUrl]: "error" }));
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
          AI searches the web for new {tripPrompt}. Adjust the slider to control how
          closely results match your closet.
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
          {busy ? "Searching the web…" : products ? "✨ Search again" : "✨ Find new pieces"}
        </button>
        <p className="text-xs text-stone-500">
          Saves nothing automatically — pick favorites with{" "}
          <span className="font-medium">+ Wishlist</span>.
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
        <p className="rounded-2xl bg-blush-50 px-3 py-2 text-sm text-blush-800">
          {error}
        </p>
      )}

      {busy && !products && (
        <p className="text-sm text-stone-500">
          Reading your closet, checking the forecast, and asking Gemini to scan the web. Usually 10–20 seconds.
        </p>
      )}

      {products && products.length === 0 && !busy && (
        <p className="text-sm text-stone-500">No usable products came back — try a different intensity.</p>
      )}

      {products && products.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const status = added[p.productUrl];
            return (
              <li key={p.productUrl} className="card flex flex-col gap-2 p-3">
                {p.imageUrl ? (
                  <a
                    href={p.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tile-bg flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt={p.productName}
                      className="h-full w-full object-contain"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </a>
                ) : null}

                <div className="min-w-0">
                  <p className="truncate font-display text-base text-stone-800">{p.productName}</p>
                  <p className="truncate text-xs text-stone-500">
                    {[p.brand, p.vendor && p.vendor !== p.brand ? p.vendor : null, p.estimatedPrice]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  {(p.category || p.color) && (
                    <p className="truncate text-[11px] uppercase tracking-wide text-stone-400">
                      {[p.category, p.color].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>

                {p.reasoning && (
                  <p className="text-sm text-stone-700">{p.reasoning}</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <a
                    href={p.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blush-600 hover:underline"
                  >
                    Open product →
                  </a>
                  <button
                    type="button"
                    onClick={() => addToWishlist(p)}
                    disabled={status === "saving" || status === "added"}
                    className="btn-secondary text-xs disabled:opacity-60"
                  >
                    {status === "added"
                      ? "✓ Added"
                      : status === "saving"
                        ? "Saving…"
                        : status === "error"
                          ? "Retry"
                          : "+ Wishlist"}
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
