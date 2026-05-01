// Daily-style suggestion: read patterns from the user's closet and ask
// Gemini's grounded search to surface ONE real product the user would
// like. Returned as a hyperlinkable name + canonical vendor URL so the
// dashboard card can wire it straight to the retailer.
//
// Like the per-item product lookup in lib/ai/productLookup.ts, the
// grounded response can't be paired with responseSchema; we ask for
// JSON in the prompt and parse defensively.

import { CATEGORIES } from "@/lib/constants";

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export type ClosetSummary = {
  totalItems: number;
  topBrands: Array<{ name: string; count: number }>;
  topColors: Array<{ name: string; count: number }>;
  categoryCounts: Record<string, number>;
  favoriteCount: number;
  /** Free-form style notes the user has written in Settings. */
  stylePreferences: string | null;
  /** A short list of subTypes the user already has, so the model
   *  doesn't suggest something obviously redundant. */
  ownedSubTypes: string[];
};

export type StyleSuggestion = {
  productName: string;
  vendor: string;
  productUrl: string;
  category: string | null;
  estimatedPrice: string | null;
  reasoning: string;
  imageUrl: string | null;
};

export type StyleSuggestionDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
  sources?: string[];
};

export type StyleSuggestionResult =
  | { ok: true; suggestion: StyleSuggestion; debug: StyleSuggestionDebug }
  | { ok: false; error: string; debug: StyleSuggestionDebug };

function describeSummary(s: ClosetSummary): string {
  const lines: string[] = [];
  lines.push(`Total items: ${s.totalItems}.`);
  if (s.topBrands.length > 0) {
    lines.push(
      `Top brands: ${s.topBrands.map((b) => `${b.name} (${b.count})`).join(", ")}.`,
    );
  }
  if (s.topColors.length > 0) {
    lines.push(
      `Top colors: ${s.topColors.map((c) => `${c.name} (${c.count})`).join(", ")}.`,
    );
  }
  const cats = Object.entries(s.categoryCounts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, n]) => `${cat} ${n}`)
    .join(", ");
  if (cats) lines.push(`Categories: ${cats}.`);
  lines.push(`Favorites: ${s.favoriteCount}.`);
  if (s.ownedSubTypes.length > 0) {
    lines.push(
      `Already owns variations of: ${s.ownedSubTypes.slice(0, 30).join(", ")}.`,
    );
  }
  if (s.stylePreferences && s.stylePreferences.trim()) {
    lines.push(`Style notes from owner: ${s.stylePreferences.trim().slice(0, 500)}`);
  }
  return lines.join(" ");
}

export async function suggestProductForCloset(
  summary: ClosetSummary,
  options?: { again?: boolean },
): Promise<StyleSuggestionResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }
  if (summary.totalItems === 0) {
    return {
      ok: false,
      error: "Closet is empty — add a few pieces first so we can read your style.",
      debug: { error: "empty closet" },
    };
  }

  const prompt = [
    "You're a stylist suggesting ONE specific product for a personal closet.",
    "Closet snapshot:",
    describeSummary(summary),
    options?.again
      ? "The user asked for a different option than the last suggestion — pick a clearly different product (different brand or category if reasonable)."
      : "",
    "Search the web for a real product on a real retailer that fits this person's taste — something they'd genuinely love to add. Don't suggest something obviously redundant with what they already own.",
    "Match the closet's apparent price tier (designer ↔ designer, mid-tier ↔ mid-tier, etc.) and color/style language.",
    "Return ONE JSON object (no prose, no markdown fences):",
    "{",
    '  "productName": string,    // exact product name as on the page',
    '  "vendor": string,         // brand or retailer (e.g., "Madewell", "Net-a-Porter")',
    '  "productUrl": string,     // canonical product page URL (must be real)',
    `  "category": string,       // one of ${JSON.stringify([...CATEGORIES])} — null if uncertain`,
    '  "estimatedPrice": string, // "$128 USD" or null if not visible',
    '  "reasoning": string,      // 1-2 sentences on why this fits the closet',
    '  "imageUrl": string | null // direct product image URL if you can pin one down',
    "}",
    "Hard rules:",
    "- productUrl MUST be a real retailer page you can verify via search. Never invent URLs.",
    "- Use null (not empty string) for any field you can't confidently fill.",
    "- Output ONLY the JSON object.",
  ]
    .filter(Boolean)
    .join(" ");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: options?.again ? 0.7 : 0.4 },
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
          debug: { status: 200, error: "non-JSON response", rawText: cleaned.slice(0, 400), sources },
        };
      }
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return {
          ok: false,
          error: "Couldn't parse a JSON object from the model's response.",
          debug: { status: 200, error: "JSON parse failed", rawText: cleaned.slice(0, 400), sources },
        };
      }
    }

    const sanitized = sanitize(parsed);
    if (!sanitized) {
      return {
        ok: false,
        error: "Model didn't return a usable product (missing name or URL).",
        debug: { status: 200, error: "missing required fields", rawText: cleaned.slice(0, 400), sources },
      };
    }
    return {
      ok: true,
      suggestion: sanitized,
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
    return { ok: false, error: detail, debug: { status: httpStatus, error: detail, rawText } };
  }
}

function sanitize(raw: unknown): StyleSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const productName =
    typeof r.productName === "string" && r.productName.trim()
      ? r.productName.trim().slice(0, 200)
      : null;
  const productUrl =
    typeof r.productUrl === "string" && /^https?:\/\//i.test(r.productUrl)
      ? r.productUrl.slice(0, 800)
      : null;
  if (!productName || !productUrl) return null;
  return {
    productName,
    productUrl,
    vendor:
      typeof r.vendor === "string" && r.vendor.trim()
        ? r.vendor.trim().slice(0, 100)
        : "",
    category:
      typeof r.category === "string" && r.category.trim()
        ? r.category.trim().slice(0, 80)
        : null,
    estimatedPrice:
      typeof r.estimatedPrice === "string" && r.estimatedPrice.trim()
        ? r.estimatedPrice.trim().slice(0, 60)
        : null,
    reasoning:
      typeof r.reasoning === "string" && r.reasoning.trim()
        ? r.reasoning.trim().slice(0, 600)
        : "",
    imageUrl:
      typeof r.imageUrl === "string" && /^https?:\/\//i.test(r.imageUrl)
        ? r.imageUrl.slice(0, 800)
        : null,
  };
}
