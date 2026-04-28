// Pick a tagging provider based on env. We don't ship a real provider —
// callers wire one in by setting AI_PROVIDER + the relevant API key. Keeps
// secrets out of the bundle and lets the user opt in deliberately.

import { DisabledProvider, type TagProvider } from "./types";

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
// Returns an empty object on any failure so the caller can keep going.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

function makeGemini(): TagProvider {
  const key = process.env.GEMINI_API_KEY;
  return {
    name: "gemini",
    available: () => !!key,
    async tagImage({ image, existingBrands }) {
      if (!key) return {};
      try {
        const buf = Buffer.from(await image.arrayBuffer());
        const mimeType = image.type || "image/jpeg";

        const brandHint =
          existingBrands && existingBrands.length > 0
            ? `If the visible brand matches one of these existing brands, return it verbatim: ${existingBrands
                .slice(0, 80)
                .join(", ")}.`
            : "";

        const prompt = `You are tagging a single piece of clothing or accessory in a personal wardrobe app.
Return strictly valid JSON, no markdown fences. Schema:
{
  "category": one of "Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories","Activewear","Loungewear","Bags","Jewelry","Bras","Underwear","Swimwear","Socks & Hosiery",
  "subType": short string like "T-shirt" or "Heels",
  "color": one of "white","cream","beige","tan","brown","black","gray","navy","blue","teal","green","olive","yellow","orange","red","burgundy","pink","blush","purple","lavender","gold","silver","multi",
  "brand": string or null,
  "seasons": array of any of "spring","summer","fall","winter",
  "activities": array of any of "casual","work","date","workout","beach","formal","travel","lounge",
  "notes": short freeform string or null,
  "confidence": number between 0 and 1
}
Omit any field you can't determine confidently. ${brandHint}`;

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
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          GEMINI_MODEL,
        )}:generateContent?key=${encodeURIComponent(key)}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.warn(`Gemini ${res.status} ${res.statusText}`);
          return {};
        }
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!text) return {};
        try {
          // Some models still wrap JSON in code fences; strip them.
          const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
          const parsed = JSON.parse(cleaned);
          return sanitizeSuggestion(parsed);
        } catch (err) {
          console.warn("Gemini returned non-JSON:", text.slice(0, 200), err);
          return {};
        }
      } catch (err) {
        console.warn("Gemini call failed", err);
        return {};
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
  if (typeof r.brand === "string") out.brand = r.brand.slice(0, 80);
  if (Array.isArray(r.seasons)) out.seasons = r.seasons.filter((x): x is string => typeof x === "string") as never;
  if (Array.isArray(r.activities)) out.activities = r.activities.filter((x): x is string => typeof x === "string") as never;
  if (typeof r.notes === "string") out.notes = r.notes.slice(0, 240);
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
      return {};
    },
  };
}
