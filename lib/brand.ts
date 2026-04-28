// Normalize a brand name into a comparable key. Strips punctuation,
// whitespace, and case so "J.Crew", "J Crew", "JCREW", "j-crew" all
// collapse to "jcrew".
export function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Levenshtein distance — small impl for similarity check on brand suggestions.
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Returns the closest existing brand from a list (by key), or null if
// nothing is within `threshold` edit distance. Used so the add form can
// warn "Did you mean 'J.Crew'?" before creating a near-duplicate.
export function findSimilar(
  candidate: string,
  existing: { name: string; key: string }[],
  threshold = 2,
): { name: string; key: string } | null {
  const k = brandKey(candidate);
  if (!k) return null;
  let best: { name: string; key: string } | null = null;
  let bestDist = Infinity;
  for (const e of existing) {
    if (e.key === k) return e; // exact key match
    const d = editDistance(k, e.key);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
