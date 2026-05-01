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
    size: { type: "STRING" },
    seasons: { type: "ARRAY", items: { type: "STRING", enum: [...ALLOWED_SEASONS] } },
    activities: { type: "ARRAY", items: { type: "STRING", enum: [...ALLOWED_ACTIVITIES] } },
    material: { type: "STRING" },
    careNotes: { type: "STRING" },
    notes: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
};

const OUTFIT_SCHEMA = {
  type: "OBJECT",
  properties: {
    itemIds: { type: "ARRAY", items: { type: "STRING" } },
    name: { type: "STRING" },
    reasoning: { type: "STRING" },
  },
  required: ["itemIds"],
};

const NOTES_SCHEMA = {
  type: "OBJECT",
  properties: {
    notes: { type: "STRING" },
  },
  required: ["notes"],
};

const SEARCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: [...ALLOWED_CATEGORIES] },
    color: { type: "STRING", enum: [...ALLOWED_COLORS] },
    season: { type: "STRING", enum: [...ALLOWED_SEASONS] },
    activity: { type: "STRING", enum: [...ALLOWED_ACTIVITIES] },
    favoritesOnly: { type: "BOOLEAN" },
    freeText: { type: "STRING" },
  },
};

function makeGemini(): TagProvider {
  const key = process.env.GEMINI_API_KEY;
  return {
    name: "gemini",
    available: () => !!key,
    async tagImage({ image, labelImage, existingBrands }) {
      if (!key) return { suggestions: {}, debug: { error: "GEMINI_API_KEY not set" } };

      let rawText = "";
      let httpStatus: number | undefined;

      try {
        const mainBuf = Buffer.from(await image.arrayBuffer());
        const mainMime = image.type || "image/jpeg";
        const labelBuf = labelImage ? Buffer.from(await labelImage.arrayBuffer()) : null;
        const labelMime = labelImage?.type || "image/jpeg";

        const brandHint =
          existingBrands && existingBrands.length > 0
            ? ` If the visible brand matches one of these existing brands, return it verbatim: ${existingBrands
                .slice(0, 60)
                .join(", ")}.`
            : "";

        const activityHint =
          ` Activities should match the garment type. ALWAYS include the obvious activity for the category: ` +
          `Swimwear → "beach"; Activewear → "workout"; Loungewear → "lounge"; ` +
          `formal gowns / cocktail dresses / blazers / suits → "formal"; ` +
          `simple everyday tops / jeans / sneakers → "casual". ` +
          `An item can have multiple activities (e.g. a sundress can be "casual" + "beach" + "travel"). ` +
          `Be generous: if the piece could plausibly suit an activity, include it.`;

        const prompt = labelBuf
          ? `You are tagging a single piece of clothing or accessory in a personal wardrobe app. ` +
            `You're given two images: the FIRST is the garment itself, the SECOND is a close-up of its brand/size/care label. ` +
            `Read the label text carefully — extract brand, size (alpha or numeric, exactly as printed), material/composition, and care instructions. ` +
            `Use the garment image for category, subType, color, seasons, activities. ` +
            `Use the enumerated values for category / color / seasons / activities — pick the CLOSEST match even if imperfect. ` +
            `Always return at least: category and color (snap color to the nearest enum value — for example a maroon item is "burgundy", a beige item is "tan"). ` +
            `Fill in as many other fields as you reasonably can. Only leave a field empty if the image is genuinely unreadable.${activityHint}${brandHint}`
          : `You are tagging a single piece of clothing or accessory in a personal wardrobe app. ` +
            `Look at the image and fill in as many fields of the response schema as you can. ` +
            `Use the enumerated values for category / color / seasons / activities — pick the CLOSEST match even if imperfect. ` +
            `Always return at least: category and color (snap color to the nearest enum value — for example a maroon item is "burgundy", a beige item is "tan"). ` +
            `Fill in as many other fields as you reasonably can. Only leave a field empty if the image is genuinely unreadable.${activityHint}${brandHint}`;

        const parts: Array<Record<string, unknown>> = [
          { text: prompt },
          { inlineData: { mimeType: mainMime, data: mainBuf.toString("base64") } },
        ];
        if (labelBuf) {
          parts.push({ inlineData: { mimeType: labelMime, data: labelBuf.toString("base64") } });
        }

        const body = {
          contents: [{ role: "user", parts }],
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

    async describeItem({ image, labelImage, context }) {
      if (!key) return { notes: "", debug: { error: "GEMINI_API_KEY not set" } };
      try {
        const mainBuf = Buffer.from(await image.arrayBuffer());
        const mainMime = image.type || "image/jpeg";
        const labelBuf = labelImage ? Buffer.from(await labelImage.arrayBuffer()) : null;
        const labelMime = labelImage?.type || "image/jpeg";

        const known: string[] = [];
        if (context?.category) known.push(`category=${context.category}`);
        if (context?.subType) known.push(`type=${context.subType}`);
        if (context?.color) known.push(`color=${context.color}`);
        if (context?.brand) known.push(`brand=${context.brand}`);
        if (context?.size) known.push(`size=${context.size}`);
        if (context?.seasons?.length) known.push(`seasons=${context.seasons.join(", ")}`);
        if (context?.activities?.length) known.push(`activities=${context.activities.join(", ")}`);

        const prompt =
          `Write 1-3 short, specific sentences describing this clothing item for a personal ` +
          `wardrobe app's notes field. Cover the visual style (cut, drape, length, neckline, ` +
          `silhouette, fabric feel) and what occasions it suits or what pieces pair well with it. ` +
          `Be concrete and useful — not flowery. Avoid restating the obvious facts already known: ` +
          `${known.join(", ") || "(no other tags yet)"}.` +
          (context?.existingNotes ? ` Existing notes already say: "${context.existingNotes.slice(0, 200)}". Don't duplicate, complement.` : "");

        const parts: Array<Record<string, unknown>> = [
          { text: prompt },
          { inlineData: { mimeType: mainMime, data: mainBuf.toString("base64") } },
        ];
        if (labelBuf) {
          parts.push({ inlineData: { mimeType: labelMime, data: labelBuf.toString("base64") } });
        }

        const body = {
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: NOTES_SCHEMA,
            temperature: 0.5,
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
        const responseText = await res.text();
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const e = JSON.parse(responseText) as { error?: { message?: string } };
            if (e.error?.message) detail = `HTTP ${res.status}: ${e.error.message}`;
          } catch {
            detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
          }
          return { notes: "", debug: { status: res.status, error: detail, rawText: responseText.slice(0, 400) } };
        }
        const data = JSON.parse(responseText) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!text) return { notes: "", debug: { status: 200, error: "Empty response", rawText: responseText.slice(0, 400) } };
        const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          // If the model didn't honour JSON mode for any reason, treat
          // the whole text as the notes.
          return { notes: cleaned.slice(0, 600) };
        }
        const r = parsed as { notes?: unknown };
        return {
          notes: typeof r.notes === "string" ? r.notes.slice(0, 600).trim() : "",
          debug: {
            status: 200,
            rawText: cleaned.slice(0, 400),
            promptTokens: data.usageMetadata?.promptTokenCount,
            responseTokens: data.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err) {
        return { notes: "", debug: { error: err instanceof Error ? err.message : String(err) } };
      }
    },

    async buildOutfit({ occasion, items }) {
      if (!key) return { itemIds: [], debug: { error: "GEMINI_API_KEY not set" } };

      // Compact the catalog so big closets don't blow our prompt budget.
      // Pro reasons over this list (no images) — image-aware would be
      // overkill and 100x slower.
      const cap = 250;
      const catalog = items.slice(0, cap).map((it) => ({
        id: it.id,
        category: it.category,
        subType: it.subType ?? undefined,
        color: it.color ?? undefined,
        brand: it.brand ?? undefined,
        seasons: it.seasons?.length ? it.seasons : undefined,
        activities: it.activities?.length ? it.activities : undefined,
      }));

      const prompt =
        `You're a personal stylist for a wardrobe app. The user is asking for an outfit for: "${occasion}". ` +
        `Pick a small set of pieces from THIS catalog (you may NOT invent items not in the catalog). ` +
        `Return their ids in the response. Aim for one cohesive outfit: include either a dress OR a top+bottom, ` +
        `usually shoes, and only add outerwear/accessories/bags/jewelry if they fit the occasion. ` +
        `Try not to combine clashing colors or wildly mismatched formality. ` +
        `Pick a short outfit name (3-5 words) and a one-sentence reasoning. ` +
        `Match the occasion to the right category: ` +
        `BEACH / pool / swim → prefer Swimwear (and shorts, sandals, sundresses, sun hats). ` +
        `WORKOUT / gym / running → prefer Activewear. ` +
        `LOUNGE / sleep / pajama → prefer Loungewear. ` +
        `FORMAL / black-tie / wedding → prefer Dresses (cocktail/gown/formal subtypes), Outerwear blazers, Shoes heels. ` +
        `Don't skip Swimwear/Activewear/Loungewear when the occasion calls for them, even if those items have no activities tagged. ` +
        `Catalog (JSON):\n${JSON.stringify(catalog)}`;

      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: OUTFIT_SCHEMA,
          temperature: 0.4,
        },
      };

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          GEMINI_MODEL,
        )}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const responseText = await res.text();
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const e = JSON.parse(responseText) as { error?: { message?: string } };
            if (e.error?.message) detail = `HTTP ${res.status}: ${e.error.message}`;
          } catch {
            detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
          }
          return { itemIds: [], debug: { status: res.status, error: detail, rawText: responseText.slice(0, 400) } };
        }
        const data = JSON.parse(responseText) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!text) {
          return { itemIds: [], debug: { status: 200, error: "Empty response", rawText: responseText.slice(0, 400) } };
        }
        const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          return { itemIds: [], debug: { status: 200, error: "Model response wasn't valid JSON", rawText: cleaned.slice(0, 400) } };
        }
        const r = parsed as { itemIds?: unknown; name?: unknown; reasoning?: unknown };
        const ownedIds = new Set(items.map((i) => i.id));
        const ids = Array.isArray(r.itemIds)
          ? r.itemIds.filter((x): x is string => typeof x === "string" && ownedIds.has(x))
          : [];
        return {
          itemIds: ids,
          name: typeof r.name === "string" ? r.name.slice(0, 80) : undefined,
          reasoning: typeof r.reasoning === "string" ? r.reasoning.slice(0, 400) : undefined,
          debug: {
            status: 200,
            rawText: cleaned.slice(0, 400),
            promptTokens: data.usageMetadata?.promptTokenCount,
            responseTokens: data.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err) {
        return { itemIds: [], debug: { error: err instanceof Error ? err.message : String(err) } };
      }
    },

    async parseSearch({ query }) {
      if (!key) return { filters: {}, debug: { error: "GEMINI_API_KEY not set" } };
      try {
        const prompt =
          `Parse the user's natural-language closet search into structured filters. ` +
          `Only set a field if the query clearly implies it. ` +
          `Use ONLY the enumerated values for category / color / season / activity. ` +
          `Map informal words: "dresses" → category=Dresses; "denim" → freeText=jeans; ` +
          `"favorites" / "I love" → favoritesOnly=true. ` +
          `Anything that doesn't fit a structured field goes in freeText (one or two short keywords). ` +
          `Query: "${query.slice(0, 200)}"`;

        const body = {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: SEARCH_SCHEMA,
            temperature: 0.0,
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
        const responseText = await res.text();
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const e = JSON.parse(responseText) as { error?: { message?: string } };
            if (e.error?.message) detail = `HTTP ${res.status}: ${e.error.message}`;
          } catch {
            detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
          }
          return { filters: {}, debug: { status: res.status, error: detail, rawText: responseText.slice(0, 400) } };
        }
        const data = JSON.parse(responseText) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!text) return { filters: {}, debug: { status: 200, error: "Empty response", rawText: responseText.slice(0, 400) } };
        const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          return { filters: {}, debug: { status: 200, error: "Model response wasn't valid JSON", rawText: cleaned.slice(0, 400) } };
        }
        const r = (parsed as Record<string, unknown>) ?? {};
        const filters: import("./types").SearchFilters = {};
        if (typeof r.category === "string") filters.category = r.category;
        if (typeof r.color === "string") filters.color = r.color.toLowerCase();
        if (typeof r.season === "string") filters.season = r.season.toLowerCase();
        if (typeof r.activity === "string") filters.activity = r.activity.toLowerCase();
        if (typeof r.favoritesOnly === "boolean") filters.favoritesOnly = r.favoritesOnly;
        if (typeof r.freeText === "string" && r.freeText.trim()) filters.freeText = r.freeText.trim().slice(0, 60);
        return {
          filters,
          debug: {
            status: 200,
            rawText: cleaned.slice(0, 400),
            promptTokens: data.usageMetadata?.promptTokenCount,
            responseTokens: data.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err) {
        return { filters: {}, debug: { error: err instanceof Error ? err.message : String(err) } };
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
  if (typeof r.size === "string" && r.size.trim()) out.size = r.size.slice(0, 40);
  if (Array.isArray(r.seasons)) out.seasons = r.seasons.filter((x): x is string => typeof x === "string") as never;
  if (Array.isArray(r.activities)) out.activities = r.activities.filter((x): x is string => typeof x === "string") as never;
  if (typeof r.material === "string" && r.material.trim()) out.material = r.material.slice(0, 120);
  if (typeof r.careNotes === "string" && r.careNotes.trim()) out.careNotes = r.careNotes.slice(0, 240);
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
