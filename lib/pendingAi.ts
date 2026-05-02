// Shape of the JSON blob stored on Item.pendingAiSuggestions when a
// bulk re-tag run finds conflicts (AI suggestions that would
// overwrite already-set fields). The item edit page reads this on
// load and surfaces the existing review panel so the user can
// approve/reject each row.
//
// We don't bake this into the schema as separate columns because:
//   - the set of fields a re-tag covers can grow over time
//     (material, careNotes, …) without new migrations
//   - per-field nullability is naturally handled by JSON
//   - a single TEXT column is cheap on SQLite

import { CATEGORIES, COLOR_NAMES, SEASONS, ACTIVITIES, type Category } from "@/lib/constants";

export type PendingAiSuggestions = {
  category?: Category;
  subType?: string;
  color?: string;
  brand?: string;
  size?: string;
  seasons?: string[];
  activities?: string[];
  material?: string;
  /** When the suggestions were staged. Used so a future cleanup task
   *  can prune stale pending blobs (e.g. from rebatched runs). */
  stagedAt?: string;
};

// Merge new suggestions into an existing pending blob, replacing any
// fields that overlap with the new ones. We keep this idempotent so
// re-running bulk tag on an item with pending suggestions doesn't
// double-stack — last run wins on each field.
export function mergePending(
  existing: PendingAiSuggestions | null,
  next: PendingAiSuggestions,
): PendingAiSuggestions {
  return { ...(existing ?? {}), ...next, stagedAt: new Date().toISOString() };
}

export function serialize(p: PendingAiSuggestions | null): string | null {
  if (!p) return null;
  const cleaned = sanitize(p);
  if (!hasAny(cleaned)) return null;
  return JSON.stringify(cleaned);
}

export function parse(raw: string | null | undefined): PendingAiSuggestions | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitize(parsed);
  } catch {
    return null;
  }
}

// Drop unknown / out-of-enum / wrong-shape values so a stale blob
// from an older schema can't crash the form.
function sanitize(input: unknown): PendingAiSuggestions {
  if (!input || typeof input !== "object") return {};
  const r = input as Record<string, unknown>;
  const out: PendingAiSuggestions = {};
  if (typeof r.category === "string" && (CATEGORIES as readonly string[]).includes(r.category)) {
    out.category = r.category as Category;
  }
  if (typeof r.subType === "string" && r.subType.trim()) out.subType = r.subType.trim();
  if (typeof r.color === "string" && (COLOR_NAMES as readonly string[]).includes(r.color)) {
    out.color = r.color;
  }
  if (typeof r.brand === "string" && r.brand.trim()) out.brand = r.brand.trim();
  if (typeof r.size === "string" && r.size.trim()) out.size = r.size.trim();
  if (Array.isArray(r.seasons)) {
    const valid = r.seasons.filter((x): x is string => typeof x === "string" && (SEASONS as readonly string[]).includes(x));
    if (valid.length > 0) out.seasons = valid;
  }
  if (Array.isArray(r.activities)) {
    const valid = r.activities.filter((x): x is string => typeof x === "string" && (ACTIVITIES as readonly string[]).includes(x));
    if (valid.length > 0) out.activities = valid;
  }
  if (typeof r.material === "string" && r.material.trim()) out.material = r.material.trim();
  if (typeof r.stagedAt === "string") out.stagedAt = r.stagedAt;
  return out;
}

function hasAny(p: PendingAiSuggestions): boolean {
  return !!(
    p.category ||
    p.subType ||
    p.color ||
    p.brand ||
    p.size ||
    (p.seasons && p.seasons.length > 0) ||
    (p.activities && p.activities.length > 0) ||
    p.material
  );
}
