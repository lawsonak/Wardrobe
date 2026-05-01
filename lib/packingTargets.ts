// Compute a sensible default packing target — number of pieces per
// category — from a trip's nights + planned activities. The user can
// override every count in the wizard, then we pass the final targets
// to the AI so it picks ~that many items per category from the closet.
//
// The defaults aim to satisfy a real-world "1 underwear per day, 1 sock
// per day, rewear bottoms" rhythm. No-mins are intentional for things
// like Dresses or Activewear so the list isn't padded for trips that
// don't need them.

import { CATEGORIES, type Category } from "@/lib/constants";

export type PackingTargets = Partial<Record<Category, number>>;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computePackingTargets(
  nights: number | null,
  activities: string[],
): PackingTargets {
  // Treat day trips and missing dates as "1 day" so the formulas stay
  // sensible — the user can always bump counts up.
  const days = nights == null ? 3 : Math.max(1, nights);
  const acts = activities.map((a) => a.toLowerCase());
  const has = (a: string) => acts.includes(a);
  const hasAny = (xs: string[]) => xs.some((x) => acts.includes(x));

  // Activity-derived flags. We treat free-form labels generously:
  // "swim" / "pool" → beach; "run" / "gym" / "hike" → workout; etc.
  const formal = hasAny(["formal", "date", "wedding", "dinners"]);
  const beach = hasAny(["beach", "swim", "pool"]) || acts.some((a) => a.includes("beach") || a.includes("pool"));
  const workout = hasAny(["workout", "gym", "yoga"]) || acts.some((a) => a.includes("hik") || a.includes("run") || a.includes("workout"));
  const lounge = hasAny(["lounge", "lounging"]) || days >= 4; // long trips deserve a lounge piece
  const work = has("work");

  const targets: PackingTargets = {
    // Daily essentials — one per day, plus a buffer for spills / longer
    // travel days.
    "Underwear": days + 1,
    "Bras": clamp(Math.ceil(days / 2), 2, 5),
    "Socks & Hosiery": days + 1,

    // Outfit pieces — assume some rewearing. Tops a touch more than
    // bottoms because they're closer to the skin.
    Tops: clamp(Math.ceil(days / 1.5), 2, 8),
    Bottoms: clamp(Math.ceil(days / 2), 1, 5),

    Outerwear: 1,
    Shoes: 2, // 1 daily + 1 alt
    Bags: 1,
    Jewelry: 1,
    Accessories: 1,

    // Conditional pieces.
    Dresses: formal ? 1 : 0,
    Activewear: workout ? clamp(Math.ceil(days / 2), 1, 4) : 0,
    Loungewear: lounge ? 1 : 0,
    Swimwear: beach ? 2 : 0,
  };

  // Nudges for specific contexts.
  if (formal) targets.Shoes = (targets.Shoes ?? 2) + 1;
  if (beach) targets.Bottoms = Math.max(targets.Bottoms ?? 0, 2); // shorts
  if (work) targets.Tops = Math.max(targets.Tops ?? 0, days);

  // Strip zero rows but keep them ordered by CATEGORIES so the wizard
  // displays them in the same order every time.
  const out: PackingTargets = {};
  for (const c of CATEGORIES) {
    const n = targets[c];
    if (typeof n === "number") out[c] = n;
  }
  return out;
}

// Round-trip helper for the wizard: ensure every category exists in
// the targets map (even at 0) so the UI can render +/- controls for
// every category the user might want.
export function fillMissingCategories(t: PackingTargets): PackingTargets {
  const out: PackingTargets = {};
  for (const c of CATEGORIES) {
    out[c] = typeof t[c] === "number" ? t[c]! : 0;
  }
  return out;
}

export function totalCount(t: PackingTargets): number {
  let n = 0;
  for (const c of CATEGORIES) n += t[c] ?? 0;
  return n;
}
