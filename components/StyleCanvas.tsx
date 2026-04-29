"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MannequinSilhouette from "@/components/MannequinSilhouette";
import { CATEGORY_TO_SLOT, type Category, type Slot } from "@/lib/constants";
import { slotDefaults, type SlotPlacement } from "@/lib/slots";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

export type CanvasItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type Layer = {
  id: string;        // unique per layer (item.id)
  src: string;
  // All values are percentages of the canvas (so it scales).
  x: number;         // center X
  y: number;         // center Y
  w: number;         // width
  rotation: number;  // degrees
  z: number;         // stacking order
  hidden: boolean;
  slot: Slot;
  label: string;
};

function slotFor(category: string): Slot {
  return CATEGORY_TO_SLOT[category as Category] ?? "accessory";
}

function srcFor(item: CanvasItem) {
  return item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
}

export default function StyleCanvas({
  outfitId,
  items,
  initialLayoutJson,
  mannequinSrc,
  landmarks,
  renderedSrc: initialRenderedSrc,
}: {
  outfitId?: string;
  items: CanvasItem[];
  initialLayoutJson?: string | null;
  mannequinSrc?: string | null;
  landmarks?: Landmarks | null;
  renderedSrc?: string | null;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [renderedSrc, setRenderedSrc] = useState<string | null>(initialRenderedSrc ?? null);
  const [renderState, setRenderState] = useState<"idle" | "running" | "error">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showRendered, setShowRendered] = useState<boolean>(!!initialRenderedSrc);

  // Per-mannequin slot placements derived from landmarks (or hardcoded
  // silhouette defaults when no calibration exists yet).
  const SLOT_DEFAULTS: Record<Slot, SlotPlacement> = useMemo(
    () => slotDefaults(landmarks ?? null),
    [landmarks],
  );

  // Build initial layers, restoring any saved layout for items that still
  // belong to this outfit.
  const initialLayers = useMemo<Layer[]>(() => {
    const saved: Record<string, Partial<Layer>> = {};
    if (initialLayoutJson) {
      try {
        const parsed = JSON.parse(initialLayoutJson) as { layers?: Layer[] };
        if (parsed?.layers) {
          for (const l of parsed.layers) saved[l.id] = l;
        }
      } catch {
        /* ignore — fall back to defaults */
      }
    }
    return items.map((it, idx) => {
      const slot = slotFor(it.category);
      const d = SLOT_DEFAULTS[slot];
      const fromSaved = saved[it.id];
      return {
        id: it.id,
        src: srcFor(it),
        x: fromSaved?.x ?? d.x,
        y: fromSaved?.y ?? d.y,
        w: fromSaved?.w ?? d.w,
        rotation: fromSaved?.rotation ?? 0,
        z: fromSaved?.z ?? d.z + idx * 0.001,
        hidden: fromSaved?.hidden ?? false,
        slot,
        label: it.subType ?? it.category,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [layers, setLayers] = useState<Layer[]>(initialLayers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Debounced autosave to /api/outfits/[id]. Skips the very first run so we
  // don't immediately re-write defaults on a fresh outfit.
  const skipNextSave = useRef(true);
  useEffect(() => {
    if (!outfitId) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/outfits/${outfitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layoutJson: JSON.stringify({ layers }) }),
        });
        if (!res.ok) throw new Error(await res.text());
        setSaveState("saved");
        setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err) {
        console.error("Save layout failed", err);
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [layers, outfitId]);

  const sorted = useMemo(() => [...layers].sort((a, b) => a.z - b.z), [layers]);

  // Active drag state (single-pointer; mobile-friendly).
  const dragRef = useRef<{
    layerId: string;
    pointerId: number;
    mode: "move" | "resize" | "rotate";
    startCanvas: DOMRect;
    startLayer: Layer;
    pointerStartX: number;
    pointerStartY: number;
  } | null>(null);

  function update(layerId: string, patch: Partial<Layer>) {
    setLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));
  }

  function bringToFront(layerId: string) {
    setLayers((prev) => {
      const maxZ = prev.reduce((m, l) => (l.z > m ? l.z : m), 0);
      return prev.map((l) => (l.id === layerId ? { ...l, z: maxZ + 1 } : l));
    });
  }

  function sendToBack(layerId: string) {
    setLayers((prev) => {
      const minZ = prev.reduce((m, l) => (l.z < m ? l.z : m), Infinity);
      return prev.map((l) => (l.id === layerId ? { ...l, z: (isFinite(minZ) ? minZ : 0) - 1 } : l));
    });
  }

  function reset(layerId: string) {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l;
        const d = SLOT_DEFAULTS[l.slot];
        return { ...l, x: d.x, y: d.y, w: d.w, rotation: 0 };
      }),
    );
  }

  function onPointerDown(e: React.PointerEvent, layerId: string, mode: "move" | "resize" | "rotate") {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    setSelectedId(layerId);
    bringToFront(layerId);
    dragRef.current = {
      layerId,
      pointerId: e.pointerId,
      mode,
      startCanvas: rect,
      startLayer: { ...layer },
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - drag.pointerStartX;
    const dyPx = e.clientY - drag.pointerStartY;
    const dxPct = (dxPx / drag.startCanvas.width) * 100;
    const dyPct = (dyPx / drag.startCanvas.height) * 100;

    if (drag.mode === "move") {
      update(drag.layerId, {
        x: clamp(drag.startLayer.x + dxPct, 5, 95),
        y: clamp(drag.startLayer.y + dyPct, 5, 95),
      });
    } else if (drag.mode === "resize") {
      const newW = clamp(drag.startLayer.w + dxPct * 1.4, 8, 95);
      update(drag.layerId, { w: newW });
    } else if (drag.mode === "rotate") {
      // Compute angle between center of layer and pointer.
      const cx = drag.startCanvas.left + (drag.startLayer.x / 100) * drag.startCanvas.width;
      const cy = drag.startCanvas.top + (drag.startLayer.y / 100) * drag.startCanvas.height;
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      update(drag.layerId, { rotation: angle });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }

  function resetAll() {
    if (!confirm("Reset every piece to its default position?")) return;
    setLayers((prev) =>
      prev.map((l) => {
        const d = SLOT_DEFAULTS[l.slot];
        return { ...l, x: d.x, y: d.y, w: d.w, rotation: 0, hidden: false };
      }),
    );
  }

  async function generateRendered() {
    if (!outfitId || renderState === "running") return;
    setRenderState("running");
    setRenderError(null);
    try {
      const res = await fetch(`/api/outfits/${outfitId}/render`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRenderedSrc(data.url ?? null);
      setShowRendered(true);
      setRenderState("idle");
      toast("Styled photo ready");
      router.refresh();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setRenderError(msg);
      setRenderState("error");
      toast("Couldn't generate styled photo", "error");
    }
  }

  async function clearRendered() {
    if (!outfitId || !renderedSrc) return;
    const ok = await confirmDialog({
      title: "Remove the styled photo?",
      body: "Goes back to the editable layout. You can regenerate any time.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/outfits/${outfitId}/render`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRenderedSrc(null);
      setShowRendered(false);
      toast("Styled photo removed");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't remove styled photo", "error");
    }
  }

  // Keep the canvas square-ish on big screens, full width on mobile.
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && <span className="text-sage-600">✓ Saved</span>}
          {saveState === "error" && <span className="text-blush-700">Save failed — retry by editing again.</span>}
          {saveState === "idle" && "Auto-saves as you edit."}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {renderedSrc && (
            <label className="chip chip-off cursor-pointer">
              <input
                type="checkbox"
                className="mr-1"
                checked={showRendered}
                onChange={(e) => setShowRendered(e.target.checked)}
              />
              Show styled photo
            </label>
          )}
          {outfitId && (
            <button
              type="button"
              onClick={generateRendered}
              disabled={renderState === "running"}
              className="btn-secondary text-xs"
              title={renderedSrc ? "Re-run the AI on this outfit" : "AI-compose this outfit on your mannequin (10-30s)"}
            >
              {renderState === "running"
                ? "✨ Styling…"
                : renderedSrc
                  ? "✨ Regenerate styled photo"
                  : "✨ Generate styled photo"}
            </button>
          )}
          {renderedSrc && (
            <button type="button" onClick={clearRendered} className="btn-ghost text-xs text-stone-500">
              Remove
            </button>
          )}
          <button type="button" onClick={resetAll} className="btn-ghost text-xs">Reset all</button>
        </div>
      </div>
      {renderError && (
        <div className="rounded-xl bg-blush-50 px-3 py-2 text-xs text-blush-800 ring-1 ring-blush-200">
          {renderError}
        </div>
      )}
      {renderState === "running" && (
        <p className="text-xs text-stone-500">
          Composing your outfit on the mannequin — this can take 10–30 seconds.
        </p>
      )}
      <div className="card p-2">
        <div
          ref={canvasRef}
          className="relative mx-auto aspect-[1/2] max-h-[70dvh] w-full select-none overflow-hidden rounded-2xl"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setSelectedId(null)}
        >
          <MannequinSilhouette src={mannequinSrc} className="absolute inset-0 h-full w-full" />
          {showRendered && renderedSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={renderedSrc}
              alt="AI-styled outfit"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
          )}
          {(showRendered && renderedSrc ? [] : sorted).map((l) =>
            l.hidden ? null : (
              <div
                key={l.id}
                onPointerDown={(e) => onPointerDown(e, l.id, "move")}
                style={{
                  position: "absolute",
                  left: `${l.x}%`,
                  top: `${l.y}%`,
                  width: `${l.w}%`,
                  transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
                  zIndex: Math.round(l.z),
                  touchAction: "none",
                  cursor: "grab",
                  outline: selectedId === l.id ? "2px dashed #f25c87" : "none",
                  outlineOffset: 2,
                  borderRadius: 8,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.src}
                  alt={l.label}
                  draggable={false}
                  className="pointer-events-none h-auto w-full object-contain"
                />
                {selectedId === l.id && (
                  <>
                    <div
                      onPointerDown={(e) => onPointerDown(e, l.id, "resize")}
                      className="absolute -bottom-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-blush-500 text-xs text-white shadow-card"
                      style={{ touchAction: "none", cursor: "nwse-resize" }}
                      aria-label="Resize"
                    >
                      ↘
                    </div>
                    <div
                      onPointerDown={(e) => onPointerDown(e, l.id, "rotate")}
                      className="absolute -top-2 -left-2 grid h-6 w-6 place-items-center rounded-full bg-blush-500 text-xs text-white shadow-card"
                      style={{ touchAction: "none", cursor: "grab" }}
                      aria-label="Rotate"
                    >
                      ⟳
                    </div>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      <ul className="card divide-y divide-stone-100 overflow-hidden">
        {layers.map((l) => {
          const selected = selectedId === l.id;
          return (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.src} alt={l.label} className="h-9 w-9 rounded-md bg-stone-50 object-contain" />
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm " + (selected ? "font-semibold text-blush-700" : "text-stone-700")}>{l.label}</p>
                <p className="text-xs text-stone-400">{l.slot}</p>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <button type="button" onClick={() => setSelectedId(l.id)} className="btn-ghost px-2">Select</button>
                <button type="button" onClick={() => update(l.id, { hidden: !l.hidden })} className="btn-ghost px-2">
                  {l.hidden ? "Show" : "Hide"}
                </button>
                <button type="button" onClick={() => bringToFront(l.id)} className="btn-ghost px-2" aria-label="Bring to front">↑</button>
                <button type="button" onClick={() => sendToBack(l.id)} className="btn-ghost px-2" aria-label="Send to back">↓</button>
                <button type="button" onClick={() => reset(l.id)} className="btn-ghost px-2">Reset</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
