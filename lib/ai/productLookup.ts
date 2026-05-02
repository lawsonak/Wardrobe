// Two paths to look up a real product on the public web from the
// item edit page:
//
// 1. `lookupProductOnline({ brand, subType, color, category })` —
//    Gemini grounded Google Search. Used when the user has a brand
//    + subType but no URL.
//
// 2. `lookupProductFromUrl(url)` — server-side `fetchProductMeta`
//    pulls Open Graph + JSON-LD Product schema directly from the
//    page, then a narrow Gemini text-mode call reads a cleaned text
//    excerpt to extract material + care (which OG/JSON-LD usually
//    omits). Faster, cheaper, no grounded-search hallucinations.
//
// Note: grounded responses can't be paired with `responseSchema`, so
// the brand-search path asks for JSON in the prompt and parses the
// text. The URL path uses responseSchema since it's a non-grounded
// text call. Failures in either are non-fatal — the UI keeps the
// existing values and shows the error.

import { fetchProductMeta } from "@/lib/productMeta";

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export type ProductLookupInput = {
  brand: string;
  subType?: string | null;
  color?: string | null;
  category?: string | null;
};

export type ProductLookupSuggestion = {
  material?: string;
  careNotes?: string;
  description?: string;
  retailPrice?: string;
  productUrl?: string;
};

export type ProductLookupDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
  sources?: string[];
};

export type ProductLookupResult =
  | { ok: true; suggestions: ProductLookupSuggestion; debug: ProductLookupDebug }
  | { ok: false; error: string; suggestions: Record<string, never>; debug: ProductLookupDebug };

export async function lookupProductOnline(
  input: ProductLookupInput,
): Promise<ProductLookupResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      suggestions: {},
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }
  const brand = input.brand.trim();
  if (!brand) {
    return {
      ok: false,
      error: "Need a brand to search for the product online.",
      suggestions: {},
      debug: { error: "no brand" },
    };
  }

  const descriptor = [input.color, input.subType, input.category]
    .filter((x): x is string => !!x && !!x.trim())
    .join(" ");
  const query = descriptor ? `${brand} ${descriptor}` : brand;

  const prompt = [
    `Search the web for "${query}" and find the manufacturer's product page (or a reliable retailer listing).`,
    "From that page, extract the following and return them as a SINGLE JSON object — nothing else, no prose, no markdown fences:",
    "  - material: fabric composition (e.g. \"100% cotton\", \"95% modal, 5% spandex\"). Null if not on the page.",
    "  - careNotes: care instructions in one short line (e.g. \"Machine wash cold, tumble dry low\"). Null if not on the page.",
    "  - description: 1-2 sentences describing the cut, fit, or notable features. Null if you can't find a real description.",
    "  - retailPrice: original retail price as a string with currency (e.g. \"$98 USD\"). Null if you can't find it.",
    "  - productUrl: canonical product page URL. Null if you can't pin one down.",
    "Hard rules:",
    "- Use null (not empty string) for any field you don't have confident evidence for. Never invent details.",
    "- Output ONLY the JSON object. No commentary before or after.",
    "- The product is a clothing or accessory item in someone's personal closet, not a generic catalog item.",
  ].join(" ");

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
          searchEntryPoint?: { renderedContent?: string };
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
      // The model sometimes wraps JSON in extra prose despite the prompt.
      // Pull out the first {…} block as a fallback.
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

    const sanitized = sanitize(parsed);
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

// URL-driven lookup. Faster + more accurate than the brand-search
// path when the user has the actual product URL handy: we fetch the
// page server-side via productMeta (parsing OG + JSON-LD), then ask
// Gemini in narrow text mode to read the cleaned page text and pull
// out the fields OG/JSON-LD usually doesn't carry — material
// composition and care instructions. This avoids both the
// hallucination footgun (model fetching the wrong page) and the
// extra cost of grounded search.
//
// Bare-domain URLs ("madewell.com/jeans") are accepted and prefixed
// with https:// before the fetch.
const URL_RE = /^https?:\/\//i;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;

export async function lookupProductFromUrl(
  rawUrl: string,
): Promise<ProductLookupResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      suggestions: {},
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Paste a product URL to look up.",
      suggestions: {},
      debug: { error: "no url" },
    };
  }
  const url = URL_RE.test(trimmed)
    ? trimmed
    : BARE_DOMAIN_RE.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!url) {
    return {
      ok: false,
      error: "Doesn't look like a URL — paste a product link or use the brand search instead.",
      suggestions: {},
      debug: { error: "not a url" },
    };
  }

  // Direct fetch — pulls OG + JSON-LD, plus a cleaned text excerpt
  // for the AI to read material/care from.
  const fetched = await fetchProductMeta(url, { includePageText: true });
  if (!fetched.ok) {
    return {
      ok: false,
      error: fetched.error,
      suggestions: {},
      debug: { error: fetched.error, rawText: fetched.debug.reason },
    };
  }
  const meta = fetched.meta;

  // Narrow Gemini classification: read the page text we already have,
  // pull material + careNotes (which OG/JSON-LD usually omit) and a
  // tighter description if the OG one was thin. retailPrice from the
  // metadata wins; ask the model only if we don't have one.
  const detailsPrompt = [
    "You're given an excerpt of an apparel/accessory product page. Read it and return a SINGLE JSON object — nothing else, no prose, no markdown:",
    "  - material: fabric composition exactly as printed (e.g. \"100% cotton\", \"95% modal, 5% spandex\"). Null if not mentioned.",
    "  - careNotes: care instructions in one short line (e.g. \"Machine wash cold, tumble dry low\"). Null if not mentioned.",
    "  - description: a 1-2 sentence factual description of the cut/fit/notable features. Null if you can't pull a real one.",
    "  - retailPrice: original retail price as a string with currency (e.g. \"$98 USD\"). Null if not stated.",
    "Hard rules: use null (not empty string) for any field you don't have evidence for. Don't invent.",
    "",
    `Product name: ${meta.name ?? "(unknown)"}`,
    `Brand: ${meta.brand ?? "(unknown)"}`,
    `Source: ${meta.source ?? "(unknown)"}`,
    "",
    "Page excerpt:",
    meta.pageText ?? meta.description ?? "",
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: detailsPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          material: { type: "STRING", nullable: true },
          careNotes: { type: "STRING", nullable: true },
          description: { type: "STRING", nullable: true },
          retailPrice: { type: "STRING", nullable: true },
        },
      },
      temperature: 0.1,
    },
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    TEXT_MODEL,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  let aiOut: { material?: string; careNotes?: string; description?: string; retailPrice?: string } = {};
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
      if (text.trim()) {
        try {
          aiOut = JSON.parse(text);
        } catch {
          /* empty aiOut keeps the OG/JSON-LD-only path working */
        }
      }
    }
  } catch {
    /* AI failure is non-fatal — return what we have from OG/JSON-LD */
  }

  // Merge: prefer the AI's material/careNotes (they aren't in OG),
  // prefer OG/JSON-LD's price + description when we have them.
  const merged: ProductLookupSuggestion = {
    material: typeof aiOut.material === "string" && aiOut.material.trim()
      ? aiOut.material.trim().slice(0, 240)
      : undefined,
    careNotes: typeof aiOut.careNotes === "string" && aiOut.careNotes.trim()
      ? aiOut.careNotes.trim().slice(0, 240)
      : undefined,
    description: meta.description?.trim()
      || (typeof aiOut.description === "string" && aiOut.description.trim()
        ? aiOut.description.trim().slice(0, 600)
        : undefined),
    retailPrice: meta.price
      || (typeof aiOut.retailPrice === "string" && aiOut.retailPrice.trim()
        ? aiOut.retailPrice.trim().slice(0, 60)
        : undefined),
    productUrl: meta.productUrl ?? url,
  };

  // Drop empty fields so the form's "only fill empties" merge doesn't
  // see noise.
  const sanitized: ProductLookupSuggestion = {};
  for (const [k, v] of Object.entries(merged) as Array<[keyof ProductLookupSuggestion, string | undefined]>) {
    if (typeof v === "string" && v.trim()) sanitized[k] = v.trim();
  }

  return {
    ok: true,
    suggestions: sanitized,
    debug: {
      status: 200,
      rawText: `direct-fetch from ${meta.source} (jsonld=${fetched.debug.usedJsonLd ? "y" : "n"} og=${fetched.debug.usedOg ? "y" : "n"} ai=${Object.keys(aiOut).length > 0 ? "y" : "n"})`,
      sources: [meta.productUrl ?? url],
    },
  };
}

function sanitize(raw: unknown): ProductLookupSuggestion {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ProductLookupSuggestion = {};
  if (typeof r.material === "string" && r.material.trim()) {
    out.material = r.material.trim().slice(0, 240);
  }
  if (typeof r.careNotes === "string" && r.careNotes.trim()) {
    out.careNotes = r.careNotes.trim().slice(0, 240);
  }
  if (typeof r.description === "string" && r.description.trim()) {
    out.description = r.description.trim().slice(0, 600);
  }
  if (typeof r.retailPrice === "string" && r.retailPrice.trim()) {
    out.retailPrice = r.retailPrice.trim().slice(0, 60);
  }
  if (typeof r.productUrl === "string" && /^https?:\/\//i.test(r.productUrl)) {
    out.productUrl = r.productUrl.slice(0, 500);
  }
  return out;
}
