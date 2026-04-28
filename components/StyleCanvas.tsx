"use client";

import { useMemo, useRef, useState } from "react";
import MannequinSilhouette from "@/components/MannequinSilhouette";
import { CATEGORY_TO_SLOT, type Category, type Slot } from "@/lib/constants";

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

// Default placement and size by slot (percent of canvas).
const SLOT_DEFAULTS: Record<Slot, { x: number; y: number; w: number; z: number }> = {
  top:       { x: 50, y: 32, w: 56, z: 4 },
  dress:     { x: 50, y: 44, w: 60, z: 3 },
  bottom:    { x: 50, y: 58, w: 50, z: 4 },
  outerwear: { x: 50, y: 38, w: 70, z: 5 },
  shoes:     { x: 50, y: 92, w: 30, z: 6 },
  accessory: { x: 50, y: 22, w: 24, z: 7 },
  bag:       { x: 78, y: 50, w: 24, z: 8 },
};

function slotFor(category: string): Slot {
  return CATEGORY_TO_SLOT[category as Category] ?? "accessory";
}

function srcFor(item: CanvasItem) {
  return item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
}

export default function StyleCanvas({ items }: { items: CanvasItem[] }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Layer[]>(() =>
    items.map((it, idx) => {
      const slot = slotFor(it.category);
      const d = SLOT_DEFAULTS[slot];
      return {
        id: it.id,
        src: srcFor(it),
        x: d.x,
        y: d.y,
        w: d.w,
        rotation: 0,
        z: d.z + idx * 0.001, // stable ordering when many items share a slot
        hidden: false,
        slot,
        label: it.subType ?? it.category,
      };
    }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Keep the canvas square-ish on big screens, full width on mobile.
  return (
    <div className="space-y-3">
      <div className="card p-2">
        <div
          ref={canvasRef}
          className="relative mx-auto aspect-[1/2] max-h-[70dvh] w-full select-none overflow-hidden rounded-2xl"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setSelectedId(null)}
        >
          <MannequinSilhouette className="absolute inset-0 h-full w-full" />
          {sorted.map((l) =>
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
