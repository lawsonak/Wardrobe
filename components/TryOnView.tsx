"use client";

import { useEffect, useRef, useState } from "react";
import StyleCanvas, { type CanvasItem } from "@/components/StyleCanvas";

type Mode = "ai" | "manual";

type GenerateResponse = {
  tryOnImagePath?: string;
  tryOnGeneratedAt?: string | null;
  hash?: string;
  fromCache?: boolean;
  skippedItemIds?: string[];
  error?: string;
};

type FreshResponse = {
  tryOnImagePath: string | null;
  storedHash: string | null;
  currentHash: string | null;
  isFresh: boolean;
  mannequinReady: boolean;
};

export default function TryOnView({
  outfitId,
  items,
  initialLayoutJson,
  initialTryOnImagePath,
  initialTryOnGeneratedAt,
  headUrl,
  headBBox,
}: {
  outfitId: string;
  items: CanvasItem[];
  initialLayoutJson: string | null;
  initialTryOnImagePath: string | null;
  initialTryOnGeneratedAt: string | null;
  /** Optional stylized head overlay served via /api/uploads/. */
  headUrl?: string | null;
  /** Where to place the head on the try-on image, normalized 0..1. */
  headBBox?: { x: number; y: number; w: number; h: number } | null;
}) {
  // Default to AI try-on. When there's no cached image yet, the
  // freshness check auto-fires generate() so the user sees the AI
  // pipeline kick off immediately instead of staring at a placeholder.
  const [mode, setMode] = useState<Mode>("ai");
  const [tryOnPath, setTryOnPath] = useState<string | null>(initialTryOnImagePath);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialTryOnGeneratedAt);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [stale, setStale] = useState(false);
  const [mannequinReady, setMannequinReady] = useState(true);
  // Tracks whether we've already auto-fired generation for this mount,
  // so the freshness check doesn't keep re-triggering.
  const autoFiredRef = useRef(false);

  // Check freshness on mount + whenever the items array changes. If
  // the user has a mannequin set up and there's no fresh try-on yet,
  // auto-fire generation once so opening the page from the outfits
  // list immediately starts the AI try-on without an extra click.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/outfits/${outfitId}/tryon`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as FreshResponse;
        if (cancelled) return;
        setMannequinReady(data.mannequinReady);
        if (data.tryOnImagePath) {
          setTryOnPath(data.tryOnImagePath);
          setStale(!data.isFresh);
        } else {
          setStale(false);
        }
        // Auto-fire on first mount when:
        //  - mannequin is ready (otherwise generate() would 500),
        //  - we haven't already auto-fired this session,
        //  - and either no try-on exists yet or the existing one is
        //    stale (items changed since last render).
        const needsGeneration = !data.tryOnImagePath || !data.isFresh;
        if (data.mannequinReady && needsGeneration && !autoFiredRef.current) {
          autoFiredRef.current = true;
          generate();
        }
      } catch {
        /* network blip — leave UI alone */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfitId, items.length]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/outfits/${outfitId}/tryon`, { method: "POST" });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok || !data.tryOnImagePath) {
        setError(data.error || `Generation failed (HTTP ${res.status})`);
        return;
      }
      setTryOnPath(data.tryOnImagePath);
      setGeneratedAt(data.tryOnGeneratedAt ?? new Date().toISOString());
      setSkippedCount(data.skippedItemIds?.length ?? 0);
      setStale(false);
      setMode("ai");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("ai")}
            disabled={!tryOnPath}
            className={
              "rounded-full px-3 py-1.5 transition " +
              (mode === "ai"
                ? "bg-blush-500 text-white shadow-card"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200 disabled:opacity-40")
            }
          >
            AI try-on
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={
              "rounded-full px-3 py-1.5 transition " +
              (mode === "manual"
                ? "bg-blush-500 text-white shadow-card"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200")
            }
          >
            Manual layout
          </button>
        </div>
        <div className="flex items-center gap-2">
          {stale && tryOnPath && !generating && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
              Outfit changed — regenerate?
            </span>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={generating || !mannequinReady}
            className="btn-primary text-xs disabled:opacity-50"
            title={!mannequinReady ? "Mannequin base image is missing on the server" : undefined}
          >
            {generating ? "Generating…" : tryOnPath ? "✨ Regenerate try-on" : "✨ Generate AI try-on"}
          </button>
        </div>
      </div>

      {!mannequinReady && (
        <div className="card border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          The mannequin base image isn&apos;t set up yet. Run{" "}
          <code className="rounded bg-amber-100 px-1">npm run generate:mannequin</code>{" "}
          (requires <code className="rounded bg-amber-100 px-1">GEMINI_API_KEY</code>) or commit a
          PNG to <code className="rounded bg-amber-100 px-1">public/mannequin/base.png</code>.
        </div>
      )}

      {error && (
        <div className="card border border-blush-300 bg-blush-50 p-3 text-xs text-blush-800">
          {error}
        </div>
      )}

      {skippedCount > 0 && (
        <div className="card bg-stone-50 p-3 text-xs text-stone-600">
          {skippedCount} item{skippedCount === 1 ? "" : "s"} weren&apos;t included in the rendered
          try-on (Gemini works best with up to 5 garments at a time).
        </div>
      )}

      {mode === "ai" && tryOnPath ? (
        <div className="card p-2">
          <div className="relative mx-auto aspect-[1/2] max-h-[70dvh] w-full overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/uploads/${tryOnPath}`}
              alt="AI try-on"
              className={
                "h-full w-full object-contain transition " + (generating ? "opacity-50" : "")
              }
            />
            {headUrl && headBBox && (
              // CSS-stacked stylized head overlay. The bbox is normalized
              // 0..1 of the same 1:2 portrait frame the try-on uses, so
              // these percentages line up with where the mannequin's head
              // sits on the AI body. No AI in the merge.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headUrl}
                alt=""
                aria-hidden
                draggable={false}
                className={"pointer-events-none absolute object-contain transition " + (generating ? "opacity-50" : "")}
                style={{
                  left: `${headBBox.x * 100}%`,
                  top: `${headBBox.y * 100}%`,
                  width: `${headBBox.w * 100}%`,
                  height: `${headBBox.h * 100}%`,
                }}
              />
            )}
            {generating && (
              <div className="absolute inset-0 grid place-items-center bg-white/40 text-sm text-stone-700">
                <div className="rounded-full bg-white/80 px-3 py-1.5 shadow-card">
                  Regenerating… 5–15s
                </div>
              </div>
            )}
          </div>
          {generatedAt && (
            <p className="mt-2 text-center text-xs text-stone-400">
              Generated {new Date(generatedAt).toLocaleString()}
            </p>
          )}
        </div>
      ) : mode === "ai" && !tryOnPath ? (
        <div className="card p-8 text-center text-sm text-stone-500">
          {generating ? (
            <span>Generating your try-on… this typically takes 5–15 seconds.</span>
          ) : (
            <span>
              No AI try-on yet. Click <strong>Generate AI try-on</strong> above to render this outfit
              on the mannequin.
            </span>
          )}
        </div>
      ) : (
        <StyleCanvas outfitId={outfitId} items={items} initialLayoutJson={initialLayoutJson} />
      )}
    </div>
  );
}
