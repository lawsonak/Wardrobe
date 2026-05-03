// "Shop for this trip" — STAGE 1 of the two-stage pipeline.
//
// Stage 1 (this file): ask Gemini to spec the IDEAL products for a
// collection — searchable descriptions, no URLs. Stage 2 takes those
// specs and runs them through Google Programmable Search to find real,
// current product pages from a curated retailer allowlist. Stage 3
// validates each URL via lib/productMeta.ts and pulls the real og:image
// + JSON-LD price.
//
// Why specs instead of URLs: Gemini's grounded search returns URLs from
// its training cutoff, so fashion items (6-12 month shelf life) come
// back dead or pointing to discontinued products. Specifying THE PRODUCT
// instead lets us find current inventory from real Google results.

import { CATEGORIES, COLOR_NAMES } from "@/lib/constants";
import { describeSummary, type ClosetSummary } from "@/lib/ai/closetSummary";
import { describeForTrip, type TripForecast } from "@/lib/weather";
import type { PackingTargets } from "@/lib/packingTargets";

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// Hard ceiling on how many specs the model may emit. Set high enough to
// cover most real packing-target totals (a long beach trip with full
// underwear/socks counts can easily hit 30+) while still capping a
// runaway prompt. The model is told the *exact* per-category counts,
// so this only kicks in for edge cases.
const MAX_SPECS = 50;

export type ShopRequest = {
  kind: "trip" | "general";
  name: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  nights: number | null;
  occasion: string | null;
  season: string | null;
  activities: string[];
  notes: string | null;
  closet: ClosetSummary;
  weather: TripForecast | null;
  targets: PackingTargets;
  intensity: number;
};

export type ProductSpec = {
  /** Plain-English search query for Google. Roughly: "[color] [subType]
   *  [brand or 'on sale'] [season/style hint]". 60-90 chars max. */
  searchQuery: string;
  /** Higher-level category, used by the UI for grouping. */
  category: string | null;
  color: string | null;
  /** Optional brand or vendor hint — when provided, helps narrow CSE. */
  brandHint: string | null;
  /** "fast-fashion" / "mid" / "designer" — used as a tiebreaker when
   *  multiple CSE hits look plausible. */
  priceTier: string | null;
  /** 1-2 sentences explaining why this fits the trip + closet. Shown
   *  on the product card so the user sees the AI's reasoning. */
  reasoning: string;
};

export type SpecDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
};

export type SpecResult =
  | { ok: true; specs: ProductSpec[]; debug: SpecDebug }
  | { ok: false; error: string; debug: SpecDebug };

function clampIntensity(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function describeIntensity(intensity: number): string {
  if (intensity <= 20) {
    return "STYLE FIT: Stay deeply within the closet's existing aesthetic — same brands, colors, and silhouettes the user already wears.";
  }
  if (intensity <= 45) {
    return "STYLE FIT: Mostly familiar — match the existing aesthetic, with one or two complementary pieces slightly outside the user's usual rotation.";
  }
  if (intensity <= 65) {
    return "STYLE FIT: Balanced — mix familiar staples with a few new aesthetics or brands the user might enjoy exploring.";
  }
  if (intensity <= 85) {
    return "STYLE FIT: Lean exploratory — push toward fresh brands, colors, and silhouettes outside the current rotation while respecting price tier and explicit style notes.";
  }
  return "STYLE FIT: Highly exploratory — actively avoid repeating brands the user already owns. Use the closet snapshot to pick a price tier and what to AVOID, not what to imitate.";
}

function describeTargets(t: PackingTargets): string {
  const lines = Object.entries(t)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([cat, n]) => `${cat}: ${n}`)
    .join(", ");
  return lines || "no specific category targets";
}

function describeTripWindow(req: ShopRequest): string {
  const parts: string[] = [];
  if (req.kind === "trip") {
    if (req.destination) parts.push(`Destination: ${req.destination}`);
    if (req.startDate && req.endDate && req.startDate !== req.endDate) {
      parts.push(`Dates: ${req.startDate} → ${req.endDate} (${req.nights ?? "?"} nights)`);
    } else if (req.startDate) {
      parts.push(`Date: ${req.startDate}`);
    }
  } else {
    if (req.occasion) parts.push(`Occasion: ${req.occasion}`);
    if (req.season) parts.push(`Season: ${req.season}`);
  }
  if (req.activities.length > 0) parts.push(`Activities: ${req.activities.join(", ")}`);
  if (req.notes && req.notes.trim()) parts.push(`Notes: ${req.notes.trim().slice(0, 400)}`);
  return parts.join(". ");
}

function buildPrompt(req: ShopRequest): string {
  const intensity = clampIntensity(req.intensity);
  const allowedCategories = CATEGORIES.join(", ");
  const allowedColors = COLOR_NAMES.join(", ");

  const totalTarget = Object.values(req.targets).reduce<number>(
    (acc, n) => acc + (typeof n === "number" ? n : 0),
    0,
  );
  // Generate one spec per piece in the user's targets — they explicitly
  // set those counts (the wizard's Quantities step), so they want a
  // suggestion for every slot. Capped at MAX_SPECS for sanity. When
  // there are no targets at all, fall back to a small default so the
  // user still gets something useful.
  const askCount = Math.max(3, Math.min(MAX_SPECS, totalTarget || 5));

  const weatherLine = req.weather
    ? describeForTrip(req.weather)
    : req.kind === "trip"
      ? "(No live forecast available — the trip is too far out or the destination wasn't given. Reason from typical seasonal climate at the destination.)"
      : "";

  return [
    req.kind === "trip"
      ? "You are a personal stylist. Build a SHOPPING SPEC for a user's upcoming trip — a list of products to look for. You will NOT return URLs. A separate search engine will resolve each spec to a real, currently-stocked product page."
      : "You are a personal stylist. Build a SHOPPING SPEC for a user's themed wardrobe collection — a list of products to look for. You will NOT return URLs. A separate search engine will resolve each spec to a real, currently-stocked product page.",
    `Collection name: ${req.name}.`,
    describeTripWindow(req),
    weatherLine,
    "",
    "User's closet snapshot:",
    describeSummary(req.closet),
    "",
    `Packing targets per category — emit ONE spec per piece counted here, summing to ~${askCount} specs total: ${describeTargets(req.targets)}.`,
    "These counts are what the user has decided they need to bring on the trip. Generate one shopping idea per piece. The user's existing closet may already cover some of these slots, so prefer suggesting variety (different cuts, colors, fits) rather than identical pieces — but stay within the per-category counts.",
    "",
    describeIntensity(intensity),
    `Closet awareness intensity: ${intensity} / 100.`,
    "",
    `Return between 3 and ${MAX_SPECS} distinct specs. Match the per-category counts above as closely as possible — if the user asked for 5 Tops, return 5 distinct top specs (different styles or colors, not 5 of the same piece). For uniform categories like Underwear or Socks where buying multiples of a single style is normal, you may emit fewer specs than the count (e.g. 2 underwear specs to cover an "Underwear: 8" target).`,
    "Each spec describes ONE product as if you were searching Google for it. Be specific enough that a search engine would surface a single canonical product (e.g. include color + fit + material), but loose enough that current inventory exists (don't lock to a discontinued style number).",
    "",
    "Return ONE JSON object (no prose, no markdown fences) of this exact shape:",
    "{",
    '  "specs": [',
    "    {",
    '      "searchQuery": string,    // 60-90 chars; "[color] [type] [brand?] [style hint?]"',
    `      "category": string|null,  // one of ${allowedCategories} — null if uncertain`,
    `      "color": string|null,     // one of ${allowedColors} — null if multi-color`,
    '      "brandHint": string|null, // brand name if you want to anchor the search; null if open',
    '      "priceTier": string|null, // "fast-fashion" | "mid" | "designer" — null if uncertain',
    '      "reasoning": string       // 1-2 sentences: why this fits the trip and the user',
    "    },",
    "    ...",
    "  ]",
    "}",
    "",
    "Hard rules:",
    `- Cap at ${MAX_SPECS} specs.`,
    "- Each searchQuery should be a query you'd actually type into a fashion retailer's search bar — no quotes, no boolean ops.",
    "- DO NOT include URLs. The downstream pipeline finds the real URL.",
    "- Use null (not empty string) for any field you can't confidently fill.",
    "- Output ONLY the JSON object.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function specifyProductsForCollection(req: ShopRequest): Promise<SpecResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }

  const prompt = buildPrompt(req);
  const intensity = clampIntensity(req.intensity);
  // High-intensity specs benefit from more sampling diversity so we
  // don't anchor too hard on the closet summary.
  const temperature = 0.3 + (intensity / 100) * 0.5;

  // No grounded search — we want pure reasoning here. Saves tokens and
  // avoids the "Gemini returns the same stale URL" failure mode that
  // started this whole rework.
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    TEXT_MODEL,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  let httpStatus: number | undefined;
  let rawText = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    const responseText = await res.text();
    rawText = responseText.slice(0, 800);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = JSON.parse(responseText) as { error?: { message?: string } };
        if (err.error?.message) detail = `HTTP ${res.status}: ${err.error.message}`;
      } catch {
        detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
      }
      return { ok: false, error: detail, debug: { status: res.status, error: detail, rawText } };
    }

    const data = JSON.parse(responseText) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: `Blocked by safety filter: ${data.promptFeedback.blockReason}`,
        debug: { status: 200, error: data.promptFeedback.blockReason, rawText },
      };
    }

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("") ?? "";

    if (!text.trim()) {
      return {
        ok: false,
        error: `Model returned no text (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
        debug: { status: 200, error: "empty text", rawText },
      };
    }

    const specs = parseAndSanitizeSpecs(text);
    if (specs.length === 0) {
      return {
        ok: false,
        error: "Model returned no usable product specs.",
        debug: { status: 200, error: "no usable specs", rawText: text.slice(0, 500) },
      };
    }

    return {
      ok: true,
      specs,
      debug: {
        status: 200,
        rawText: text.slice(0, 500),
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: detail, debug: { status: httpStatus, error: detail, rawText } };
  }
}

function parseAndSanitizeSpecs(text: string): ProductSpec[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const specs = (parsed as { specs?: unknown }).specs;
  if (!Array.isArray(specs)) return [];

  const out: ProductSpec[] = [];
  for (const r of specs) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const searchQuery =
      typeof o.searchQuery === "string" && o.searchQuery.trim()
        ? o.searchQuery.trim().slice(0, 200)
        : null;
    if (!searchQuery) continue;
    out.push({
      searchQuery,
      category:
        typeof o.category === "string" && o.category.trim()
          ? o.category.trim().slice(0, 80)
          : null,
      color:
        typeof o.color === "string" && o.color.trim()
          ? o.color.trim().slice(0, 80)
          : null,
      brandHint:
        typeof o.brandHint === "string" && o.brandHint.trim()
          ? o.brandHint.trim().slice(0, 120)
          : null,
      priceTier:
        typeof o.priceTier === "string" && o.priceTier.trim()
          ? o.priceTier.trim().slice(0, 40)
          : null,
      reasoning:
        typeof o.reasoning === "string" && o.reasoning.trim()
          ? o.reasoning.trim().slice(0, 600)
          : "",
    });
    if (out.length >= MAX_SPECS) break;
  }
  return out;
}
