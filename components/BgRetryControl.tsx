"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

// Per-photo "Adjust cutout" control. Renders a small chip that
// expands into a 5-step slider (0..4) and an Apply button. Posts to
// /api/items/[id]/redo-bg with optional photoId. The default slider
// value is 2 (no-op) so a user who opens the panel and immediately
// taps Apply just gets the same cutout — they need to slide first to
// see a difference.
//
// Levels:
//   0  Most loose — fuzzy edges remain
//   1  Loose
//   2  Normal (default model output)
//   3  Tight
//   4  Most tight — hard clipped edges
const LEVEL_LABELS = ["Most loose", "Loose", "Normal", "Tight", "Most tight"];

export default function BgRetryControl({
  itemId,
  photoId,
  variant = "inline",
}: {
  itemId: string;
  /** Set when retrying a label / angle ItemPhoto. Null/undefined
   *  means the item's hero photo. */
  photoId?: string;
  /** "inline" lays out as a small inline chip + sliding panel below.
   *  "button" lays out as a single button that opens a modal sheet —
   *  used in the labels / angles strips where vertical space is
   *  cramped. */
  variant?: "inline" | "button";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/items/${itemId}/redo-bg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, photoId: photoId ?? null }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(data?.error ?? "Couldn't redo the cutout", "error");
        return;
      }
      toast(`Cutout redone — ${LEVEL_LABELS[level]}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "button") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-blush-600 hover:underline"
        >
          ↻ Adjust cutout
        </button>
        {open && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => !busy && setOpen(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="card w-full max-w-md p-4"
            >
              <Panel
                level={level}
                setLevel={setLevel}
                busy={busy}
                onCancel={() => setOpen(false)}
                onApply={apply}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  // inline
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-blush-600 hover:underline"
      >
        {open ? "Cancel adjustment" : "↻ Adjust cutout aggressiveness"}
      </button>
      {open && (
        <div className="rounded-xl bg-cream-50 p-3 ring-1 ring-stone-100">
          <Panel
            level={level}
            setLevel={setLevel}
            busy={busy}
            onCancel={() => setOpen(false)}
            onApply={apply}
          />
        </div>
      )}
    </div>
  );
}

function Panel({
  level,
  setLevel,
  busy,
  onCancel,
  onApply,
}: {
  level: number;
  setLevel: (v: number) => void;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <p className="text-sm font-medium text-stone-800">Cutout aggressiveness</p>
      <p className="mt-1 text-xs text-stone-500">
        Loose preserves fuzzy edges (background may bleed in); tight cuts
        harder (the garment may lose detail). Normal is the default model
        output.
      </p>
      <div className="mt-3 space-y-1">
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={level}
          onChange={(e) => setLevel(parseInt(e.target.value, 10))}
          disabled={busy}
          className="w-full"
          aria-label="Cutout aggressiveness"
        />
        <div className="flex justify-between text-[10px] text-stone-500">
          <span>Most loose</span>
          <span>Loose</span>
          <span>Normal</span>
          <span>Tight</span>
          <span>Most tight</span>
        </div>
        <p className="text-center text-xs font-medium text-blush-700">
          {LEVEL_LABELS[level]}
        </p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-ghost text-xs text-stone-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="btn-primary text-xs"
        >
          {busy ? "Re-running…" : "Apply"}
        </button>
      </div>
    </>
  );
}
