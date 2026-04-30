// When the user filters by activity (or asks AI for an outfit for an
// activity), some categories should be inferred — a Swimwear item
// should always show up under "beach" even if its activities CSV is
// empty, because that's the *point* of swimwear. Same for Activewear
// → workout, Loungewear → lounge.
//
// Used by:
//   - /wardrobe page activity filter
//   - /outfits page activity filter
//   - OutfitBuilder client-side activity filter
//   - the AI tag/outfit prompts (as documentation hints)

export const ACTIVITY_TO_INFERRED_CATEGORIES: Record<string, string[]> = {
  beach: ["Swimwear"],
  workout: ["Activewear"],
  lounge: ["Loungewear"],
};

/** Categories that should appear when the user filters by `activity`,
 *  in addition to items that explicitly have that activity tagged. */
export function inferredCategoriesFor(activity: string): string[] {
  return ACTIVITY_TO_INFERRED_CATEGORIES[activity] ?? [];
}

/** Client-side check for an item against an activity filter. Used by
 *  the OutfitBuilder filter where we already have items in memory. */
export function itemMatchesActivity(
  item: { category: string; activities: string | string[] | null },
  activity: string,
): boolean {
  const acts = Array.isArray(item.activities)
    ? item.activities
    : (item.activities ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (acts.length === 0) {
    // Untagged items match the filter when their category implies it.
    return inferredCategoriesFor(activity).includes(item.category);
  }
  if (acts.includes(activity)) return true;
  return inferredCategoriesFor(activity).includes(item.category);
}
