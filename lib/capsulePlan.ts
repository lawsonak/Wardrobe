// Helpers for the Capsule trip-planning fields. Both `targetCounts`
// and `activityTargets` are stored as JSON strings on the row so we
// can extend them without further migrations.

export type TargetCounts = Record<string, number>;

export type ActivityTarget = {
  activity: string;
  label: string;
  count: number;
};

export function parseTargetCounts(raw: string | null | undefined): TargetCounts {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TargetCounts = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n < 1000) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeTargetCounts(value: TargetCounts | null | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  const cleaned: TargetCounts = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== "string" || !k.trim()) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1000) cleaned[k] = Math.floor(n);
  }
  if (Object.keys(cleaned).length === 0) return null;
  return JSON.stringify(cleaned);
}

export function parseActivityTargets(raw: string | null | undefined): ActivityTarget[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): ActivityTarget | null => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const activity = typeof r.activity === "string" ? r.activity.trim() : "";
        const label = typeof r.label === "string" ? r.label.trim() : "";
        const count = Number(r.count);
        if (!activity || !label) return null;
        if (!Number.isFinite(count) || count <= 0 || count > 50) return null;
        return { activity, label, count: Math.floor(count) };
      })
      .filter((x): x is ActivityTarget => !!x);
  } catch {
    return [];
  }
}

export function serializeActivityTargets(
  value: ActivityTarget[] | null | undefined,
): string | null {
  if (!value || value.length === 0) return null;
  const cleaned = value
    .filter((r) => r && r.activity && r.label && r.count > 0)
    .slice(0, 30)
    .map((r) => ({
      activity: r.activity.slice(0, 40),
      label: r.label.slice(0, 80),
      count: Math.floor(Math.max(1, Math.min(50, r.count))),
    }));
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}
