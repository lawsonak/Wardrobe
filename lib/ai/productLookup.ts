// Use Gemini's grounded Google Search tool to look up real product
// details (fabric, care, description, retail price) from the public web.
// Triggered manually from the item edit page when the user has a brand
// + subType but is missing structured details — the AI tagger pulls
// what it can from the photo, this fills in things you can only get
// from a product page.
//
// Note: grounded responses can't be paired with `responseSchema`, so
// we ask for JSON in the prompt and parse the text. Failures are
// non-fatal — the UI keeps the existing values and shows the error.

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
