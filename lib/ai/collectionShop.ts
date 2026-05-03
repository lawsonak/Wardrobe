// "Shop for this trip" — given a collection (trip or themed set),
// the user's closet snapshot, packing targets, and optional weather
// forecast, ask Gemini's grounded search for a list of real products
// to buy. Same Gemini-grounded-search pattern as styleSuggestion.ts,
// but tuned to:
//  - return MANY products (3-15) covering the trip's needs head-to-toe,
//  - tag each result with the category it fills so the UI can render
//    "1 of 2 shoes", "2 of 5 tops", etc against the packing targets,
//  - scale the prompt based on a 0-100 "closet awareness" slider so the
//    user can flip between "stay in my lane" and "show me something new".

import { CATEGORIES, COLOR_NAMES } from "@/lib/constants";
import { describeSummary, type ClosetSummary } from "@/lib/ai/closetSummary";
import { describeForTrip, type TripForecast } from "@/lib/weather";
import type { PackingTargets } from "@/lib/packingTargets";

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// Cap the number of products we surface in one call. Gemini's grounded
// search starts hallucinating URLs once you ask for too many results;
// 15 is a safe ceiling that still covers the longest packing list.
const MAX_RESULTS = 15;

export type ShopRequest = {
  /** "trip" or "general" — colors the prompt language. */
  kind: "trip" | "general";
  name: string;
  destination: string | null;
  /** ISO date string (YYYY-MM-DD) or null. */
  startDate: string | null;
  endDate: string | null;
  /** Number of nights (null when missing dates). */
  nights: number | null;
  occasion: string | null;
  season: string | null;
  activities: string[];
  notes: string | null;
  closet: ClosetSummary;
  /** Set when the trip falls inside the 16-day forecast window. */
  weather: TripForecast | null;
  /** Per-category targets from computePackingTargets. */
  targets: PackingTargets;
  /** 0 = stay close to current style; 100 = fully exploratory. */
  intensity: number;
};

export type ShopProduct = {
  productName: string;
  brand: string | null;
  vendor: string | null;
  productUrl: string;
  category: string | null;
  color: string | null;
  estimatedPrice: string | null;
  reasoning: string;
  /** Best-effort image URL (often missing from grounded responses). */
  imageUrl: string | null;
};

export type ShopDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
  sources?: string[];
};

export type ShopResult =
  | { ok: true; products: ShopProduct[]; debug: ShopDebug }
  | { ok: false; error: string; debug: ShopDebug };

function clampIntensity(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function describeIntensity(intensity: number): string {
  if (intensity <= 20) {
    return [
      "STYLE FIT: Strongly match the closet's existing aesthetic.",
      "Stick to the brands, colors, and silhouettes the user already wears.",
      "Each product should feel like it could have come from the same closet.",
    ].join(" ");
  }
  if (intensity <= 45) {
    return [
      "STYLE FIT: Mostly match the closet's existing aesthetic, with a couple of complementary pieces that are slightly outside the user's usual rotation.",
    ].join(" ");
  }
  if (intensity <= 65) {
    return [
      "STYLE FIT: Balanced — mix familiar staples with a few new aesthetics or brands the user might enjoy exploring.",
    ].join(" ");
  }
  if (intensity <= 85) {
    return [
      "STYLE FIT: Lean exploratory — the user wants inspiration. Push toward fresh brands, colors, and silhouettes outside their current rotation, while still respecting their price tier and any explicit style notes.",
    ].join(" ");
  }
  return [
    "STYLE FIT: Highly exploratory — the user is actively shopping for newness. Pick brands and aesthetics they don't already own, treat the closet snapshot as a reference for size/price tier and what to AVOID repeating, not what to imitate.",
  ].join(" ");
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
  // Keep the model's actual count in [3, MAX_RESULTS]. The packing
  // target is the user's planning budget — for a 3-day trip the target
  // might be 12 items, but we don't need 12 NEW pieces to fill it; the
  // closet covers most of it. Asking for one product per planned slot
  // overshoots wildly, so we cap at MAX_RESULTS and treat the targets
  // as the upper bound.
  const askCount = Math.max(3, Math.min(MAX_RESULTS, totalTarget || 5));

  const weatherLine = req.weather
    ? describeForTrip(req.weather)
    : req.kind === "trip"
      ? "(No live forecast available — the trip is too far out or the destination wasn't given. Reason from typical seasonal climate at the destination if you can; otherwise stay versatile.)"
      : "";

  return [
    req.kind === "trip"
      ? "You're a personal stylist building a NEW SHOPPING LIST for a user's upcoming trip."
      : "You're a personal stylist building a NEW SHOPPING LIST for a user's themed wardrobe collection.",
    `Collection name: ${req.name}.`,
    describeTripWindow(req),
    weatherLine,
    "",
    "User's closet snapshot:",
    describeSummary(req.closet),
    "",
    `Packing targets (per category, total pieces planned): ${describeTargets(req.targets)}.`,
    "These are the user's TOTAL packing goals — including pieces they already own. Don't suggest a separate item for every slot; instead, suggest products that would close the GAPS or upgrade weak spots in the existing closet, while staying inside the relevant categories.",
    "",
    describeIntensity(intensity),
    `Closet awareness intensity: ${intensity} / 100.`,
    "",
    `Return ${askCount} distinct products (no fewer than 3) using GROUNDED search to find real items on real retailers. Spread them across the categories called for by the trip — don't return five tops if the trip needs shoes and outerwear too.`,
    "Match the closet's apparent price tier (designer ↔ designer, mid-tier ↔ mid-tier, etc).",
    "If a forecast is provided, the items must be appropriate for that weather (e.g. don't suggest sandals in 40°F rain).",
    "",
    "Return ONE JSON object (no prose, no markdown fences) of this exact shape:",
    "{",
    '  "products": [',
    "    {",
    '      "productName": string,    // exact product name as on the page',
    '      "brand": string | null,   // brand name (e.g. "Madewell")',
    '      "vendor": string | null,  // retailer if different from brand (e.g. "Net-a-Porter")',
    '      "productUrl": string,     // canonical product page URL — MUST be real and verified via search',
    `      "category": string | null,// one of ${allowedCategories} — null if uncertain`,
    `      "color": string | null,   // one of ${allowedColors} — null if multi-color or unknown`,
    '      "estimatedPrice": string | null, // "$128 USD" — null if you can\'t see one',
    '      "reasoning": string,      // 1-2 sentences: why this fits the trip and the user\'s style',
    '      "imageUrl": string | null // direct image URL if you can pin one down',
    "    },",
    "    ...",
    "  ]",
    "}",
    "",
    "Hard rules:",
    "- Every productUrl MUST be a real retailer page you can verify via grounded search. Never invent URLs. If you can't confirm a product, drop it from the list rather than fabricating.",
    "- Use null (not empty string) for any field you can't confidently fill.",
    `- Cap at ${MAX_RESULTS} products total. Don't pad the list.`,
    "- Output ONLY the JSON object. No commentary before or after.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function findItemsForCollection(req: ShopRequest): Promise<ShopResult> {
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
  // High-intensity searches benefit from more sampling diversity so we
  // don't anchor too hard on the closet snapshot.
  const temperature = 0.3 + (intensity / 100) * 0.5;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature },
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
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
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
    const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.uri)
      .filter((x): x is string => !!x);

    if (!text.trim()) {
      return {
        ok: false,
        error: `Model returned no text (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
        debug: { status: 200, error: "empty text", rawText, sources },
      };
    }

    const parsed = parseShopResponse(text);
    if (!parsed) {
      return {
        ok: false,
        error: "Couldn't parse a JSON product list from the model's response.",
        debug: { status: 200, error: "non-JSON response", rawText: text.slice(0, 500), sources },
      };
    }

    const products = sanitizeProducts(parsed);
    if (products.length === 0) {
      return {
        ok: false,
        error: "Model returned no usable products.",
        debug: {
          status: 200,
          error: "no usable products",
          rawText: text.slice(0, 500),
          sources,
        },
      };
    }

    return {
      ok: true,
      products,
      debug: {
        status: 200,
        rawText: text.slice(0, 500),
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        sources,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: detail, debug: { status: httpStatus, error: detail, rawText } };
  }
}

function parseShopResponse(text: string): unknown[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const products = (parsed as { products?: unknown }).products;
  if (!Array.isArray(products)) return null;
  return products;
}

function sanitizeProducts(raw: unknown[]): ShopProduct[] {
  const out: ShopProduct[] = [];
  const seenUrls = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;

    const productName =
      typeof o.productName === "string" && o.productName.trim()
        ? o.productName.trim().slice(0, 200)
        : null;
    const productUrl =
      typeof o.productUrl === "string" && /^https?:\/\//i.test(o.productUrl)
        ? o.productUrl.slice(0, 800)
        : null;
    if (!productName || !productUrl) continue;
    if (seenUrls.has(productUrl)) continue;
    seenUrls.add(productUrl);

    out.push({
      productName,
      productUrl,
      brand:
        typeof o.brand === "string" && o.brand.trim()
          ? o.brand.trim().slice(0, 120)
          : null,
      vendor:
        typeof o.vendor === "string" && o.vendor.trim()
          ? o.vendor.trim().slice(0, 120)
          : null,
      category:
        typeof o.category === "string" && o.category.trim()
          ? o.category.trim().slice(0, 80)
          : null,
      color:
        typeof o.color === "string" && o.color.trim()
          ? o.color.trim().slice(0, 80)
          : null,
      estimatedPrice:
        typeof o.estimatedPrice === "string" && o.estimatedPrice.trim()
          ? o.estimatedPrice.trim().slice(0, 60)
          : null,
      reasoning:
        typeof o.reasoning === "string" && o.reasoning.trim()
          ? o.reasoning.trim().slice(0, 600)
          : "",
      imageUrl:
        typeof o.imageUrl === "string" && /^https?:\/\//i.test(o.imageUrl)
          ? o.imageUrl.slice(0, 800)
          : null,
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
