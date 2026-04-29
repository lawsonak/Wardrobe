import { lastWearISO, daysSince } from "@/lib/wear";

// Deterministic "pick of the day": stable for the whole calendar day,
// rotates tomorrow. Lightly biases toward items the user hasn't worn
// recently so the dashboard feels like a rediscovery.

type Pickable = {
  id: string;
  isFavorite: boolean;
  notes: string | null;
  updatedAt: Date;
};

// Tiny string-hash → uniform 0..1, seeded by ISO date. Stable across
// servers and restarts.
function seededFraction(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1_000_000) / 1_000_000;
}

export function pickOfTheDay<T extends Pickable>(items: T[], today = new Date()): T | null {
  if (items.length === 0) return null;
  const iso = today.toISOString().slice(0, 10);

  // Score each item: rediscovery bonus + favorite bonus + a stable
  // per-day pseudo-random jitter so we don't always pick the same one.
  const scored = items.map((it) => {
    const lastWore = lastWearISO(it.notes);
    const dormancy = lastWore ? daysSince(lastWore, today) : daysSince(it.updatedAt.toISOString().slice(0, 10), today);
    const base = Math.min(1, dormancy / 120); // 0 at fresh, 1 at 4mo+
    const fav = it.isFavorite ? 0.15 : 0;
    const jitter = seededFraction(`${iso}:${it.id}`) * 0.4;
    return { item: it, score: base + fav + jitter };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}
