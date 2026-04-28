// Pick a tagging provider based on env. We don't ship a real provider —
// callers wire one in by setting AI_PROVIDER + the relevant API key. Keeps
// secrets out of the bundle and lets the user opt in deliberately.

import { DisabledProvider, type TagProvider, type TagResult } from "./types";

let _cached: TagProvider | null = null;

export function getProvider(): TagProvider {
  if (_cached) return _cached;
  const which = (process.env.AI_PROVIDER ?? "").toLowerCase();
  switch (which) {
    case "gemini":
      _cached = makeGemini();
      break;
    case "openai":
      _cached = makeOpenAI();
      break;
    default:
      _cached = new DisabledProvider();
  }
  return _cached;
}

// Real Gemini provider: posts the image as inline base64 to
// generativelanguage.googleapis.com and asks for a JSON tag suggestion.
// Always returns a TagResult — debug info is populated when the call
// fails or returns nothing useful so the UI can surface a real reason.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const ALLOWED_CATEGORIES = [
  "Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories","Activewear",
  "Loungewear","Bags","Jewelry","Bras","Underwear","Swimwear","Socks & Hosiery",
] as const;
const ALLOWED_COLORS = [
  "white","cream","beige","tan","brown","black","gray","navy","blue","teal",
  "green","olive","yellow","orange","red","burgundy","pink","blush","purple",
  "lavender","gold","silver","multi",
] as const;
const ALLOWED_SEASONS = ["spring","summer","fall","winter"] as const;
const ALLOWED_ACTIVITIES = [
  "casual","work","date","workout","beach","formal","travel","lounge",
] as const;

// Force-feed Gemini a structured response schema so it can't free-form.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: [...ALLOWED_CATEGORIES] },
    subType: { type: "STRING" },
    color: { type: "STRING", enum: [...ALLOWED_COLORS] },
    brand: { type: "STRING" },
    seasons: { type: "ARRAY", items: { type: "STRING", enum: [...ALLOWED_SEASONS] } },
    activities: { type: "ARRAY", items: { type: "STRING", enum: [...ALLOWED_ACTIVITIES] } },
    notes: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
};

function makeGemini(): TagProvider {
  const key = process.env.GEMINI_API_KEY;
  return {
    name: "gemini",
    available: () => !!key,
    async tagImage({ image, existingBrands }) {
      if (!key) return { suggestions: {}, debug: { error: "GEMINI_API_KEY not set" } };

      let rawText = "";
      let httpStatus: number | undefined;

      try {
        const buf = Buffer.from(await image.arrayBuffer());
        const mimeType = image.type || "image/jpeg";

        const brandHint =
          existingBrands && existingBrands.length > 0
            ? ` If the visible brand matches one of these existing brands, return it verbatim: ${existingBrands
                .slice(0, 60)
                .join(", ")}.`
            : "";

        const prompt =
          `You are tagging a single piece of clothing or accessory in a personal wardrobe app. ` +
          `Look at the image and fill in as many fields of the response schema as you can. ` +
          `Use only the enumerated values for category / color / seasons / activities. ` +
          `Omit a field if you genuinely can't tell — never guess wildly.${brandHint}`;

        const body = {
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: buf.toString("base64") } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          GEMINI_MODEL,
        )}:generateContent?key=${encodeURIComponent(key)}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        const responseText = await res.text();

        if (!res.ok) {
          // Surface the API error message directly. These usually carry
          // a clear `error.message` like "API key not valid" or "Quota
          // exceeded for…" so the user knows what to fix.
          let detail = `HTTP ${res.status}`;
          try {
            const err = JSON.parse(responseText) as { error?: { message?: string } };
            if (err.error?.message) detail = `HTTP ${res.status}: ${err.error.message}`;
          } catch {
            detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
          }
          console.warn(`Gemini ${detail}`);
          return { suggestions: {}, debug: { status: res.status, error: detail, rawText: responseText.slice(0, 400) } };
        }

        const data = JSON.parse(responseText) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            finishReason?: string;
            safetyRatings?: unknown;
          }>;
          promptFeedback?: { blockReason?: string };
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };

        if (data.promptFeedback?.blockReason) {
          return {
            suggestions: {},
            debug: {
              status: 200,
              error: `Blocked by safety filter: ${data.promptFeedback.blockReason}`,
              rawText: responseText.slice(0, 400),
            },
          };
        }

        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!rawText) {
          return {
            suggestions: {},
            debug: {
              status: 200,
              error: `Empty response (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
              rawText: responseText.slice(0, 400),
            },
          };
        }

        const cleaned = rawText.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (err) {
          console.warn("Gemini returned non-JSON:", cleaned.slice(0, 200), err);
          return {
            suggestions: {},
            debug: { status: 200, error: "Model response wasn't valid JSON", rawText: cleaned.slice(0, 400) },
          };
        }

        const sanitized = sanitizeSuggestion(parsed);
        const result: TagResult = {
          suggestions: sanitized,
          debug: {
            status: 200,
            rawText: rawText.slice(0, 400),
            promptTokens: data.usageMetadata?.promptTokenCount,
            responseTokens: data.usageMetadata?.candidatesTokenCount,
          },
        };
        return result;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn("Gemini call failed", err);
        return { suggestions: {}, debug: { status: httpStatus, error: detail, rawText: rawText.slice(0, 400) } };
      }
    },
  };
}

function sanitizeSuggestion(raw: unknown): import("./types").TagSuggestion {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: import("./types").TagSuggestion = {};
  if (typeof r.category === "string") out.category = r.category as never;
  if (typeof r.subType === "string") out.subType = r.subType.slice(0, 100);
  if (typeof r.color === "string") out.color = r.color.toLowerCase();
  if (typeof r.brand === "string" && r.brand.trim()) out.brand = r.brand.slice(0, 80);
  if (Array.isArray(r.seasons)) out.seasons = r.seasons.filter((x): x is string => typeof x === "string") as never;
  if (Array.isArray(r.activities)) out.activities = r.activities.filter((x): x is string => typeof x === "string") as never;
  if (typeof r.notes === "string" && r.notes.trim()) out.notes = r.notes.slice(0, 240);
  if (typeof r.confidence === "number") out.confidence = Math.max(0, Math.min(1, r.confidence));
  return out;
}

function makeOpenAI(): TagProvider {
  const key = process.env.OPENAI_API_KEY;
  return {
    name: "openai",
    available: () => !!key,
    async tagImage() {
      // TODO: call OpenAI Responses API with image input.
      return { suggestions: {} };
    },
  };
}
