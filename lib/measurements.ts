// Body measurements. Stored as a JSON blob on User.measurements
// (free-form so sections can grow without migrations, same pattern as
// Item.fitDetails). Owner-scoped + private by the per-profile design.
//
// Lengths are stored in the user's chosen `unit` (in | cm) exactly as
// entered — no normalization on disk so the form round-trips without
// rounding drift. Helpers convert on demand (the bra calc + the
// future AI-prompt summary want inches).

export type MeasurementUnit = "in" | "cm";

export type CoreMeasurements = {
  height?: number;
  bust?: number;
  waist?: number;
  hips?: number;
  shoulder?: number;
  sleeve?: number;
  inseam?: number;
  /** US shoe size — a sizing scale, not a length, so it's unitless. */
  shoeUS?: number;
};

// ABraThatFits-style inputs. The user enters the soft-tape numbers;
// `size` is the computed band+cup, pre-filled from the calc but
// user-overridable (some people know their real-world size differs).
export type BraMeasurements = {
  underbust?: number; // snug, the band measure
  bustStanding?: number;
  bustLeaning?: number;
  bustLying?: number;
  size?: string;
};

export type ExtraMeasurements = {
  neck?: number;
  thigh?: number;
  /** lb when unit=in, kg when unit=cm — follows the unit toggle. */
  weight?: number;
  /** US ring size — a scale string ("6.5"), not a length. */
  ringSize?: string;
  notes?: string;
};

export type Measurements = {
  unit: MeasurementUnit;
  updatedAt: string;
  core: CoreMeasurements;
  bra?: BraMeasurements;
  extra?: ExtraMeasurements;
};

// ── Unit conversion ────────────────────────────────────────────────
const CM_PER_IN = 2.54;
export function toInches(value: number, unit: MeasurementUnit): number {
  return unit === "cm" ? value / CM_PER_IN : value;
}
export function fromInches(inches: number, unit: MeasurementUnit): number {
  return unit === "cm" ? inches * CM_PER_IN : inches;
}

// ── Validation ─────────────────────────────────────────────────────
// Sane min/max per field IN INCHES. Out-of-range values are dropped on
// sanitize so a fat-fingered "330" can't poison the AI prompts that
// will consume this in later phases. The form should surface a friendly
// error before it ever gets here, but this is the hard backstop.
const RANGE_IN: Record<string, [number, number]> = {
  height: [36, 90],
  bust: [18, 80],
  waist: [16, 80],
  hips: [18, 90],
  shoulder: [8, 32],
  sleeve: [10, 44],
  inseam: [16, 48],
  underbust: [18, 64],
  bustStanding: [18, 80],
  bustLeaning: [18, 80],
  bustLying: [18, 80],
  neck: [8, 32],
  thigh: [10, 48],
};

function cleanLength(
  raw: unknown,
  key: string,
  unit: MeasurementUnit,
): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const range = RANGE_IN[key];
  if (range) {
    const inches = toInches(raw, unit);
    if (inches < range[0] || inches > range[1]) return undefined;
  }
  // Keep at most one decimal — tape precision doesn't exceed that.
  return Math.round(raw * 10) / 10;
}

// ── ABraThatFits-style cup math ────────────────────────────────────
// Faithful-enough US sizing: band = underbust (snug) rounded to the
// nearest even inch; cup from the bust−band difference in inches. We
// take the largest of the standing/leaning/lying bust numbers like
// ABTF does (the loosest tissue position gives the truest cup). This
// is an estimate the user can override — not a fitting-room guarantee.
const US_CUPS = [
  "AA", "A", "B", "C", "D", "DD", "DDD", "G", "H", "I", "J", "K",
];

export function computeBraSize(
  bra: BraMeasurements | undefined,
  unit: MeasurementUnit,
): string | null {
  if (!bra || typeof bra.underbust !== "number") return null;
  const ub = toInches(bra.underbust, unit);
  const busts = [bra.bustStanding, bra.bustLeaning, bra.bustLying]
    .filter((x): x is number => typeof x === "number" && x > 0)
    .map((x) => toInches(x, unit));
  if (busts.length === 0) return null;
  const bust = Math.max(...busts);

  let band = Math.round(ub);
  if (band % 2 !== 0) band += 1; // round up to the nearest even band
  const diff = Math.round(bust - band);
  if (diff < 0) return `${band}${US_CUPS[0]}`;
  const cup = US_CUPS[Math.min(diff, US_CUPS.length - 1)];
  return `${band}${cup}`;
}

// ── Serialize / parse / sanitize ───────────────────────────────────
function num(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.round(raw * 10) / 10
    : undefined;
}
function str(raw: unknown, max: number): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, max) : undefined;
}

export function sanitize(input: unknown): Measurements | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const unit: MeasurementUnit = r.unit === "cm" ? "cm" : "in";

  const c = (r.core ?? {}) as Record<string, unknown>;
  const core: CoreMeasurements = {};
  for (const k of ["height", "bust", "waist", "hips", "shoulder", "sleeve", "inseam"] as const) {
    const v = cleanLength(c[k], k, unit);
    if (v !== undefined) core[k] = v;
  }
  const shoe = num(c.shoeUS);
  if (shoe !== undefined && shoe >= 1 && shoe <= 20) core.shoeUS = shoe;

  let bra: BraMeasurements | undefined;
  const b = (r.bra ?? {}) as Record<string, unknown>;
  const braOut: BraMeasurements = {};
  for (const k of ["underbust", "bustStanding", "bustLeaning", "bustLying"] as const) {
    const v = cleanLength(b[k], k, unit);
    if (v !== undefined) braOut[k] = v;
  }
  const computed = computeBraSize(braOut, unit);
  const overridden = str(b.size, 12);
  if (overridden) braOut.size = overridden;
  else if (computed) braOut.size = computed;
  if (Object.keys(braOut).length > 0) bra = braOut;

  let extra: ExtraMeasurements | undefined;
  const e = (r.extra ?? {}) as Record<string, unknown>;
  const extraOut: ExtraMeasurements = {};
  const neck = cleanLength(e.neck, "neck", unit);
  if (neck !== undefined) extraOut.neck = neck;
  const thigh = cleanLength(e.thigh, "thigh", unit);
  if (thigh !== undefined) extraOut.thigh = thigh;
  const weight = num(e.weight);
  if (weight !== undefined && weight >= 30 && weight <= 700) extraOut.weight = weight;
  const ring = str(e.ringSize, 8);
  if (ring) extraOut.ringSize = ring;
  const notes = str(e.notes, 500);
  if (notes) extraOut.notes = notes;
  if (Object.keys(extraOut).length > 0) extra = extraOut;

  return {
    unit,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
    core,
    bra,
    extra,
  };
}

export function parse(raw: string | null | undefined): Measurements | null {
  if (!raw) return null;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serialize(m: Measurements | null): string | null {
  if (!m) return null;
  const clean = sanitize(m);
  if (!clean) return null;
  // Drop the row entirely when the user has nothing filled in — keeps
  // "has measurements?" checks honest for the later AI phases.
  if (
    Object.keys(clean.core).length === 0 &&
    !clean.bra &&
    !clean.extra
  ) {
    return null;
  }
  return JSON.stringify(clean);
}

// Has the user filled in enough for the downstream features to be
// worth switching on? (Phases B-D gate their UI on this.)
export function hasUsableMeasurements(m: Measurements | null): boolean {
  if (!m) return false;
  return Object.keys(m.core).length > 0 || !!m.bra?.size;
}
