// AI auto-fill for the wishlist form: take either a product URL the
// user pasted or a free-text query ("white linen blazer Madewell")
// and return enough structured fields to pre-fill the wishlist row.
//
// Built on Gemini's grounded Google Search tool — same pattern as
// `lib/ai/productLookup.ts` (manual lookup on the item edit page),
// but the response shape is wider since wishlist entries don't have
// a photo to fall back on for category/color inference.
//
// Note: grounded responses can't be paired with `responseSchema`, so
// we ask for JSON in the prompt and parse the text. Failures are
// non-fatal — the UI keeps whatever the user already typed.

import { CATEGORIES, COLOR_NAMES } from "@/lib/constants";
import { fetchProductMeta, type ProductMeta } from "@/lib/productMeta";

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export type WishlistLookupInput = {
  /** Either a product URL or a free-text query like "white linen blazer Madewell". */
  query: string;
};

export type WishlistLookupSuggestion = {
  name?: string;
  brand?: string;
  category?: string;
  color?: string;
  link?: string;
  price?: string;
  description?: string;
};

export type WishlistLookupDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
  sources?: string[];
};

export type WishlistLookupResult =
  | { ok: true; suggestions: WishlistLookupSuggestion; debug: WishlistLookupDebug }
  | { ok: false; error: string; suggestions: Record<string, never>; debug: WishlistLookupDebug };

const URL_RE = /^https?:\/\//i;
// Bare-domain matcher: at least one dot, alphanumeric/hyphen tokens,
// optional path. Used to accept "madewell.com/jeans" as a URL too.
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;

// Treat both `https://...` URLs and bare domains ("madewell.com/...")
// as URL input. Returns the canonical https-prefixed form.
function asUrlInput(query: string): string | null {
  if (URL_RE.test(query)) return query;
  if (BARE_DOMAIN_RE.test(query)) return `https://${query}`;
  return null;
}

// Amazon URLs come with long tracking suffixes ("/ref=…", marketplace
// query strings, etc.) and the site often blocks bots — both push the
// grounded search toward an unrelated result. Strip to the canonical
// `/dp/<ASIN>` form before passing to the model. ASINs are exactly 10
// chars of `[A-Z0-9]`. Returns the input unchanged if not Amazon or
// no ASIN is recoverable (short links like amzn.to fall through).
function canonicalizeAmazonUrl(input: string): string {
  try {
    const u = new URL(input);
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return input;
    const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
    if (!m) return input;
    return `https://${u.hostname}/dp/${m[1].toUpperCase()}`;
  } catch {
    return input;
  }
}

function safeHost(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function lookupWishlistProduct(
  input: WishlistLookupInput,
): Promise<WishlistLookupResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      suggestions: {},
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }
  const query = input.query.trim();
  if (!query) {
    return {
      ok: false,
      error: "Need a URL or product description.",
      suggestions: {},
      debug: { error: "no query" },
    };
  }

  // Detect URL vs free-text query. Accept bare domains too — auto-
  // prepending https:// is a no-op when the user already typed it.
  const urlForm = asUrlInput(query);
  const isUrl = !!urlForm;
  // Amazon URLs in particular drop a lot of tracking junk and the site
  // routinely blocks scrapers — canonicalize first so the model sees a
  // stable address. No-op for non-Amazon input.
  const cleanedQuery = urlForm ? canonicalizeAmazonUrl(urlForm) : query;
  const inputHost = urlForm ? safeHost(cleanedQuery) : null;

  // For URL inputs, try a direct server-side fetch first. Most retailers
  // embed Open Graph + JSON-LD Product metadata in their HTML; pulling
  // it ourselves is faster than asking Gemini to "visit the URL" and
  // sidesteps the hallucination footgun where grounded search wanders
  // to a different product when the page can't be reached. We only
  // call Gemini afterward to classify the extracted text into
  // category + color (a narrow, fast text-only call).
  if (isUrl) {
    const direct = await fetchProductMeta(cleanedQuery);
    if (direct.ok) {
      const classified = await classifyFromMeta(key, direct.meta);
      const merged: WishlistLookupSuggestion = {
        name: direct.meta.name,
        brand: direct.meta.brand,
        link: direct.meta.productUrl ?? cleanedQuery,
        price: direct.meta.price,
        description: direct.meta.description,
        category: classified.category,
        color: classified.color,
      };
      // Prune empty fields so the form-side "only fill empties" guard
      // doesn't see lots of empty strings.
      const sanitized = pruneEmpty(merged);
      return {
        ok: true,
        suggestions: sanitized,
        debug: {
          status: 200,
          rawText: `direct-fetch from ${direct.debug.source} (jsonld=${direct.debug.usedJsonLd ? "y" : "n"} og=${direct.debug.usedOg ? "y" : "n"})`,
          sources: [direct.meta.productUrl ?? cleanedQuery],
        },
      };
    }
    // Direct fetch failed (404, blocked, no metadata, etc.). Fall
    // through to grounded search — that gives Gemini a chance via
    // its own crawler index. The downstream domain-mismatch guard
    // and stronger prompt rules still apply.
  }

  const taskLine = isUrl
    ? `Visit this exact URL: ${cleanedQuery}\nIt's a product page on a clothing or accessory retailer's site.`
    : `Search the web for "${cleanedQuery}" and find the manufacturer's product page (or a reliable retailer listing).`;

  const allowedColors = COLOR_NAMES.join(", ");
  const allowedCategories = CATEGORIES.join(", ");

  const prompt = [
    taskLine,
    "Extract the following and return them as a SINGLE JSON object — nothing else, no prose, no markdown fences:",
    "  - name: short product name (e.g. \"Linen blazer\", \"Slip dress\"). 60 chars max. Null if you can't tell.",
    "  - brand: the brand name (e.g. \"Madewell\", \"J.Crew\"). Null if unknown.",
    `  - category: the closest match from this list: ${allowedCategories}. Null if you can't classify.`,
    `  - color: the closest match from this list: ${allowedColors}. Null if multi-color or unknown.`,
    "  - link: canonical product page URL. Null if you can't pin one down.",
    "  - price: original retail price as a string with currency (e.g. \"$98 USD\"). Null if you can't find it.",
    "  - description: 1-2 sentences describing the cut, fit, or notable features. Null if no real description.",
    "Hard rules:",
    "- CRITICAL: if the URL fails to load, returns an error, blocks scraping, or you can't extract verifiable details from a real product page, return null for EVERY field. Do not guess from the URL string. Do not pivot to a different product that happened to come up in a search. A 'no result' response is correct when you can't confirm what you're looking at.",
    isUrl
      ? `- The user pasted a URL on ${inputHost ?? "this domain"}. The 'link' field in your response MUST point to the same domain. If the only product you can confirm is from a different domain, return null for every field instead of substituting it.`
      : "- Only return fields you have grounding evidence for. Don't fabricate brand or price.",
    "- Use null (not empty string) for any field you don't have confident evidence for. Never invent details.",
    "- Output ONLY the JSON object. No commentary before or after.",
    "- The user is adding this to their personal wishlist, so prioritize the buyer-facing details (name, brand, category, color) over technical ones.",
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2 },
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
    rawText = responseText.slice(0, 600);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = JSON.parse(responseText) as { error?: { message?: string } };
        if (err.error?.message) detail = `HTTP ${res.status}: ${err.error.message}`;
      } catch {
        detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
      }
      return {
        ok: false,
        error: detail,
        suggestions: {},
        debug: { status: res.status, error: detail, rawText },
      };
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
        suggestions: {},
        debug: { status: 200, error: data.promptFeedback.blockReason, rawText },
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
    const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.uri)
      .filter((x): x is string => !!x);

    if (!text.trim()) {
      return {
        ok: false,
        error: `Model returned no text (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
        suggestions: {},
        debug: { status: 200, error: "empty text", rawText, sources },
      };
    }

    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return {
          ok: false,
          error: "Couldn't parse a JSON object from the model's response.",
          suggestions: {},
          debug: { status: 200, error: "non-JSON response", rawText: cleaned.slice(0, 400), sources },
        };
      }
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return {
          ok: false,
          error: "Couldn't parse a JSON object from the model's response.",
          suggestions: {},
          debug: { status: 200, error: "JSON parse failed", rawText: cleaned.slice(0, 400), sources },
        };
      }
    }

    const sanitized = sanitize(parsed, isUrl ? cleanedQuery : undefined);

    // Cross-domain mismatch guard. When the user pasted a URL but the
    // model's returned `link` points to a different host, the model
    // probably couldn't load the original page and pivoted to whatever
    // came up in a fallback search — the rest of the response is
    // unreliable. Better to fail loudly than silently fill the form
    // with the wrong product.
    if (isUrl && inputHost && sanitized.link) {
      const returnedHost = safeHost(sanitized.link);
      if (returnedHost && returnedHost !== inputHost) {
        return {
          ok: false,
          error: `Couldn't reliably load that page (the AI returned details from ${returnedHost} instead of ${inputHost}). Try the manufacturer's product URL or just type the name and brand.`,
          suggestions: {},
          debug: {
            status: 200,
            error: "domain mismatch",
            rawText: cleaned.slice(0, 400),
            sources,
          },
        };
      }
    }

    return {
      ok: true,
      suggestions: sanitized,
      debug: {
        status: 200,
        rawText: cleaned.slice(0, 400),
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        sources,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: detail,
      suggestions: {},
      debug: { status: httpStatus, error: detail, rawText },
    };
  }
}

function sanitize(raw: unknown, fallbackLink?: string): WishlistLookupSuggestion {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: WishlistLookupSuggestion = {};
  if (typeof r.name === "string" && r.name.trim()) {
    out.name = r.name.trim().slice(0, 100);
  }
  if (typeof r.brand === "string" && r.brand.trim()) {
    out.brand = r.brand.trim().slice(0, 80);
  }
  if (typeof r.category === "string" && (CATEGORIES as readonly string[]).includes(r.category)) {
    out.category = r.category;
  }
  if (typeof r.color === "string") {
    const lower = r.color.toLowerCase().trim();
    if ((COLOR_NAMES as readonly string[]).includes(lower)) out.color = lower;
  }
  if (typeof r.link === "string" && URL_RE.test(r.link)) {
    out.link = r.link.slice(0, 500);
  } else if (fallbackLink) {
    // The user pasted a URL — preserve it on the wishlist row even if
    // the model didn't echo a canonical link back.
    out.link = fallbackLink.slice(0, 500);
  }
  if (typeof r.price === "string" && r.price.trim()) {
    out.price = r.price.trim().slice(0, 60);
  }
  if (typeof r.description === "string" && r.description.trim()) {
    out.description = r.description.trim().slice(0, 600);
  }
  return out;
}

// Drop empty / undefined keys from a suggestion so the form's "only
// fill empties" merge logic doesn't see noise. Also normalizes a
// trailing-whitespace title from JSON-LD ("  Linen Blazer  ").
function pruneEmpty(s: WishlistLookupSuggestion): WishlistLookupSuggestion {
  const out: WishlistLookupSuggestion = {};
  for (const [k, v] of Object.entries(s) as Array<[keyof WishlistLookupSuggestion, string | undefined]>) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out[k] = trimmed;
  }
  return out;
}

// Classify already-extracted product text into category + color via
// a narrow text-only Gemini call. Cheaper and faster than the
// grounded-search call because there's nothing to fetch — we already
// have the page's name/brand/description in hand. Returns empty
// suggestions on any failure (the caller already has the rest of the
// fields from the direct fetch).
async function classifyFromMeta(
  apiKey: string,
  meta: ProductMeta,
): Promise<{ category?: string; color?: string }> {
  const text = [meta.name, meta.brand, meta.description]
    .filter((x): x is string => !!x && !!x.trim())
    .join(" — ")
    .slice(0, 1200);
  if (!text) return {};

  const allowedColors = COLOR_NAMES.join(", ");
  const allowedCategories = CATEGORIES.join(", ");
  const prompt = [
    "You're given product details from a clothing or accessory retailer's page:",
    text,
    "Return a SINGLE JSON object — nothing else, no prose, no markdown — with two fields:",
    `  - category: closest match from this list: ${allowedCategories}. Null if you genuinely can't tell.`,
    `  - color: closest match from this list: ${allowedColors}. Null if multi-color, photo-only, or unknown.`,
    "Use null (not empty string) if you don't have confident evidence. Don't invent.",
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", nullable: true },
          color: { type: "STRING", nullable: true },
        },
      },
      temperature: 0.1,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    TEXT_MODEL,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const t = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
    if (!t.trim()) return {};
    const parsed = JSON.parse(t) as { category?: string | null; color?: string | null };
    const out: { category?: string; color?: string } = {};
    if (typeof parsed.category === "string" && (CATEGORIES as readonly string[]).includes(parsed.category)) {
      out.category = parsed.category;
    }
    if (typeof parsed.color === "string") {
      const lower = parsed.color.toLowerCase().trim();
      if ((COLOR_NAMES as readonly string[]).includes(lower)) out.color = lower;
    }
    return out;
  } catch {
    return {};
  }
}
