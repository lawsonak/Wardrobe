// Read-only render of an outfit's items overlaid on the mannequin.
// Reuses the same slot defaults and saved-layout shape as StyleCanvas
// so cards look identical to the user's drag-drop layout when saved,
// and look reasonable on default positions otherwise.
//
// Server component — no interactivity, no client JS payload. The
// canvas is portrait (aspect-[1/2]) to match the editor's geometry.

import MannequinSilhouette from "@/components/MannequinSilhouette";
import { CATEGORY_TO_SLOT, type Category, type Slot } from "@/lib/constants";
import { slotDefaults } from "@/lib/slots";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";

type Item = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type LayoutLayer = {
  id: string;
  x: number;
  y: number;
  w: number;
  rotation: number;
  z: number;
  hidden?: boolean;
};

function srcFor(item: Item): string {
  return item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
}

export default function OutfitMiniCanvas({
  items,
  layoutJson,
  mannequinSrc,
  renderedSrc,
  landmarks,
  className,
}: {
  items: Item[];
  layoutJson?: string | null;
  mannequinSrc?: string | null;
  /** When set, render this single composed image instead of the layered
   *  cutouts. Used by the AI "styled photo" feature. */
  renderedSrc?: string | null;
  /** Anatomical anchor points used to fit clothing to this specific
   *  mannequin. When absent, falls back to hardcoded silhouette defaults. */
  landmarks?: Landmarks | null;
  className?: string;
}) {
  if (renderedSrc) {
    return (
      <div className={"relative aspect-[1/2] overflow-hidden " + (className ?? "")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={renderedSrc}
          alt="Styled outfit"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  const defaults = slotDefaults(landmarks);

  const saved: Record<string, LayoutLayer> = {};
  if (layoutJson) {
    try {
      const parsed = JSON.parse(layoutJson) as { layers?: LayoutLayer[] };
      for (const l of parsed.layers ?? []) saved[l.id] = l;
    } catch {
      /* ignore — fall back to defaults */
    }
  }

  const layers = items
    .map((it, idx) => {
      const slot = (CATEGORY_TO_SLOT[it.category as Category] ?? "accessory") as Slot;
      const d = defaults[slot];
      const fromSaved = saved[it.id];
      return {
        id: it.id,
        src: srcFor(it),
        label: it.subType ?? it.category,
        x: fromSaved?.x ?? d.x,
        y: fromSaved?.y ?? d.y,
        w: fromSaved?.w ?? d.w,
        rotation: fromSaved?.rotation ?? 0,
        z: fromSaved?.z ?? d.z + idx * 0.001,
        hidden: fromSaved?.hidden ?? false,
      };
    })
    .sort((a, b) => a.z - b.z);

  return (
    <div className={"relative aspect-[1/2] overflow-hidden " + (className ?? "")}>
      <MannequinSilhouette src={mannequinSrc ?? null} className="absolute inset-0 h-full w-full" />
      {layers.map((l) =>
        l.hidden ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={l.id}
            src={l.src}
            alt={l.label}
            draggable={false}
            className="pointer-events-none absolute h-auto object-contain"
            style={{
              left: `${l.x}%`,
              top: `${l.y}%`,
              width: `${l.w}%`,
              transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
              zIndex: Math.round(l.z),
            }}
          />
        ),
      )}
    </div>
  );
}
