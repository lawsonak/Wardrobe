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

  const isUrl = URL_RE.test(query);
  const taskLine = isUrl
    ? `Visit this URL: ${query}\nIt's a product page on a clothing or accessory retailer's site.`
    : `Search the web for "${query}" and find the manufacturer's product page (or a reliable retailer listing).`;

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

    const sanitized = sanitize(parsed, isUrl ? query : undefined);
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
