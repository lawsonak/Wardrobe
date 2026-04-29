// Wear-tracking helpers. We avoid a schema migration by encoding wear
// events as `[Worn: YYYY-MM-DD]` lines appended to an item's `notes`
// field. Visible to the user as a small history; parseable here for
// dormancy nudges and dashboard "today's pick" weighting.

const WEAR_LINE = /\[Worn:\s*(\d{4})-(\d{2})-(\d{2})\]/g;

export function todayISO(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function appendWear(notes: string | null | undefined, iso: string): string {
  const base = (notes ?? "").trimEnd();
  // Don't double-stamp on the same day — keeps notes clean if the user
  // taps "Wore today" twice.
  if (lastWearISO(base) === iso) return base;
  const stamp = `[Worn: ${iso}]`;
  return base ? `${base}\n${stamp}` : stamp;
}

export function lastWearISO(notes: string | null | undefined): string | null {
  if (!notes) return null;
  let latest: string | null = null;
  WEAR_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WEAR_LINE.exec(notes)) !== null) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    if (!latest || iso > latest) latest = iso;
  }
  return latest;
}

export function wearCount(notes: string | null | undefined): number {
  if (!notes) return 0;
  WEAR_LINE.lastIndex = 0;
  let n = 0;
  while (WEAR_LINE.exec(notes) !== null) n++;
  return n;
}

export function daysSince(iso: string, now: Date = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const then = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - then) / 86_400_000));
}
