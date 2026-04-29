"use client";

// Tiny haptic-feedback helper. Uses the standard navigator.vibrate
// API, which works on Android Chrome and is a silent no-op on iOS
// Safari (no API exists). For the gift recipient on iPhone, calling
// this is harmless — it just won't buzz. Wiring it now means we
// don't have to touch call sites if iOS ever exposes a real haptic
// API and we wire it in here.

export type HapticPattern =
  | "selection"  // smallest possible — toggling a chip
  | "tap"        // light tap — favoriting, picking
  | "success"    // positive completion — save, generate done
  | "warning"    // double pulse — soft warning
  | "impact";    // firmer single pulse — destructive confirm

const PATTERNS: Record<HapticPattern, number | number[]> = {
  selection: 5,
  tap: 10,
  success: [10, 30, 10],
  warning: [20, 50, 20],
  impact: 25,
};

export function haptic(pattern: HapticPattern = "tap"): void {
  if (typeof navigator === "undefined") return;
  // navigator.vibrate's TS lib type expects Iterable<number>; pass an
  // array (single-pulse patterns get wrapped) so we satisfy both old
  // and new lib.dom.d.ts shapes.
  const value = PATTERNS[pattern];
  const arr = Array.isArray(value) ? value : [value];
  const nav = navigator as Navigator & { vibrate?: (p: number[]) => boolean };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(arr);
  } catch {
    /* some browsers throw if called outside a user gesture; ignore */
  }
}
