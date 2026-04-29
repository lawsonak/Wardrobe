// Compute per-slot default placement (x, y, width — all percentages of
// the canvas) for the StyleCanvas, derived from the user's mannequin
// landmarks when known. Falls back to the original hardcoded defaults
// (tuned for the SVG silhouette) when landmarks aren't available.
//
// All values are 0..100, x measured from left, y from top, width as a
// fraction of canvas width. Items get rendered with
//   transform: translate(-50%, -50%)
// so x/y are *centers*, not top-lefts.

import type { Slot } from "@/lib/constants";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";

export type SlotPlacement = { x: number; y: number; w: number; z: number };

// Canvas-relative defaults for the SVG silhouette. Keep these in sync
// with the values the StyleCanvas previously hardcoded.
export const FALLBACK_SLOT_DEFAULTS: Record<Slot, SlotPlacement> = {
  top:       { x: 50, y: 32, w: 56, z: 4 },
  dress:     { x: 50, y: 44, w: 60, z: 3 },
  bottom:    { x: 50, y: 58, w: 50, z: 4 },
  outerwear: { x: 50, y: 38, w: 70, z: 5 },
  shoes:     { x: 50, y: 92, w: 30, z: 6 },
  accessory: { x: 50, y: 22, w: 24, z: 7 },
  bag:       { x: 78, y: 50, w: 24, z: 8 },
};

export function slotDefaults(landmarks: Landmarks | null | undefined): Record<Slot, SlotPlacement> {
  if (!landmarks) return FALLBACK_SLOT_DEFAULTS;
  const lm = landmarks;
  const shoulderWidth = Math.max(10, Math.abs(lm.rightShoulderX - lm.leftShoulderX));
  const hipWidth = Math.max(10, Math.abs(lm.rightHipX - lm.leftHipX));
  const centerX = (lm.leftShoulderX + lm.rightShoulderX) / 2;

  // Vertical centers per slot, biased toward sensible coverage.
  const torsoMidY = (lm.shoulderY + lm.waistY) / 2;
  const legsMidY = (lm.hipY + lm.ankleY) / 2;
  const dressMidY = (lm.shoulderY + lm.kneeY) / 2;
  const outerMidY = (lm.shoulderY + lm.kneeY) / 2;
  const accessoryY = (lm.chinY + lm.shoulderY) / 2; // near collar / necklace zone

  // Widths sized to landmark spread, with a small "bloom" so cutouts
  // visually overshoot the body silhouette like real clothing does.
  const topWidth = clamp(shoulderWidth * 1.4, 35, 80);
  const dressWidth = clamp(shoulderWidth * 1.5, 40, 85);
  const bottomWidth = clamp(hipWidth * 1.5, 30, 75);
  const outerWidth = clamp(shoulderWidth * 1.7, 45, 92);
  const shoesWidth = clamp(hipWidth * 0.8, 18, 40);
  const accessoryWidth = clamp(shoulderWidth * 0.6, 18, 32);

  return {
    top: {
      x: centerX,
      y: torsoMidY,
      w: topWidth,
      z: FALLBACK_SLOT_DEFAULTS.top.z,
    },
    dress: {
      x: centerX,
      y: dressMidY,
      w: dressWidth,
      z: FALLBACK_SLOT_DEFAULTS.dress.z,
    },
    bottom: {
      x: centerX,
      y: legsMidY,
      w: bottomWidth,
      z: FALLBACK_SLOT_DEFAULTS.bottom.z,
    },
    outerwear: {
      x: centerX,
      y: outerMidY,
      w: outerWidth,
      z: FALLBACK_SLOT_DEFAULTS.outerwear.z,
    },
    shoes: {
      // Center the shoes between ankle and bottom of canvas so the
      // shoe cutout sits below the legs without overlapping calves.
      x: centerX,
      y: clamp((lm.ankleY + 100) / 2, 80, 98),
      w: shoesWidth,
      z: FALLBACK_SLOT_DEFAULTS.shoes.z,
    },
    accessory: {
      x: centerX,
      y: accessoryY,
      w: accessoryWidth,
      z: FALLBACK_SLOT_DEFAULTS.accessory.z,
    },
    bag: {
      // Hang the bag off the figure on the viewer-right side, near
      // the natural hip line.
      x: clamp(lm.rightHipX + 12, 60, 92),
      y: lm.hipY,
      w: clamp(hipWidth * 0.7, 18, 32),
      z: FALLBACK_SLOT_DEFAULTS.bag.z,
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
