// Barcode (UPC / EAN) lookup. Two-stage, mirrors wishlist-lookup's
// pattern: try a free direct fetch first (Open Beauty Facts) for the
// happy path of widely-distributed products, fall back to Gemini
// grounded search for the long tail.
//
// Open Beauty Facts is a sister project to Open Food Facts —
// open-data community DB of cosmetics, free, no API key. Coverage is
// strong for major brands (MAC, NARS, Maybelline, L'Oréal, Sephora
// house) and decent for indie brands. JSON-LD product shape.
//
// When OBF returns a hit, we get name/brand/categories/image with no
// AI cost. When it misses, Gemini fills the gap.

const OBF_BASE = "https://world.openbeautyfacts.org/api/v2/product";

export type BarcodeMatch = {
  /** Display name as it appears on packaging. */
  name: string;
  /** Brand string — typically "MAC", "Maybelline", etc. */
  brand: string | null;
  /** Best-guess product category mapped to BEAUTY_CATEGORIES when
   *  the source is precise enough; otherwise free-text closest fit. */
  category: string | null;
  /** Shade name pulled from the product name when present
   *  (e.g. "Ruby Woo" from "MAC Lipstick - Ruby Woo"). */
  shadeName: string | null;
  /** Primary product image — usually a packaging shot. */
  imageUrl: string | null;
  /** Canonical product page URL on the source. */
  productUrl: string | null;
};

export type BarcodeLookupResult = {
  ok: true;
  source: "open-beauty-facts" | "gemini" | "none";
  match: BarcodeMatch | null;
  debug?: {
    obfStatus?: number;
    obfFound?: boolean;
    geminiStatus?: number;
    geminiError?: string;
  };
} | {
  ok: false;
  error: string;
};

/** Validate a barcode string. Accepts 8-14 digits — covers EAN-8,
 *  UPC-A (12), EAN-13, and the rarer 14-digit forms. Strips any
 *  whitespace, hyphens, or stray dashes the user may have typed. */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

export async function lookupBarcode(code: string): Promise<BarcodeLookupResult> {
  const normalized = normalizeBarcode(code);
  if (!normalized) {
    return { ok: false, error: "Barcode must be 8-14 digits." };
  }

  // Stage 1: Open Beauty Facts.
  const obf = await tryOpenBeautyFacts(normalized);
  if (obf) {
    return {
      ok: true,
      source: "open-beauty-facts",
      match: obf.match,
      debug: { obfStatus: obf.status, obfFound: true },
    };
  }

  // Stage 2: Gemini grounded search fallback. Returns null when the
  // model is disabled or when the response can't be parsed — both
  // get reported as source: "none" so the caller can show "no match
  // found, fill in manually" without distinguishing the cause.
  // (At this point obf is always null because the truthy branch
  // returned above; no obfStatus to forward.)
  const gemini = await tryGeminiSearch(normalized);
  if (gemini.match) {
    return {
      ok: true,
      source: "gemini",
      match: gemini.match,
      debug: {
        obfFound: false,
        geminiStatus: gemini.status,
        geminiError: gemini.error,
      },
    };
  }

  return {
    ok: true,
    source: "none",
    match: null,
    debug: {
      obfFound: false,
      geminiStatus: gemini.status,
      geminiError: gemini.error,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Open Beauty Facts

type OBFProduct = {
  product_name?: string;
  brands?: string;
  categories?: string;
  categories_tags?: string[];
  image_url?: string;
  image_front_url?: string;
  url?: string;
};

type OBFResponse = {
  status: number;          // 1 = found, 0 = not found
  product?: OBFProduct;
};

async function tryOpenBeautyFacts(
  code: string,
): Promise<{ match: BarcodeMatch; status: number } | null> {
  let res: Response;
  try {
    res = await fetch(`${OBF_BASE}/${encodeURIComponent(code)}.json`, {
      headers: {
        // OBF asks API consumers to identify themselves so they can
        // diagnose load issues. Lowercase user agent is fine.
        "User-Agent": "Wardrobe/1.0 (self-hosted personal wardrobe app)",
      },
    });
  } catch {
    // Network blip — let Gemini fallback take over. Report status 0
    // so the caller can see we did try.
    return null;
  }
  if (!res.ok) return null;

  let body: OBFResponse;
  try {
    body = (await res.json()) as OBFResponse;
  } catch {
    return null;
  }

  if (body.status !== 1 || !body.product) return null;
  const p = body.product;
  if (!p.product_name?.trim()) return null;

  const name = p.product_name.trim().slice(0, 200);
  const brand = pickFirst(p.brands)?.slice(0, 80) ?? null;
  const category = mapOBFCategory(p.categories_tags ?? [], p.categories ?? "");
  const shadeName = guessShadeFromName(name);
  const imageUrl = pickHttps(p.image_front_url ?? p.image_url ?? null);
  const productUrl = pickHttps(p.url ?? null) ?? `https://world.openbeautyfacts.org/product/${code}`;

  return {
    status: res.status,
    match: { name, brand, category, shadeName, imageUrl, productUrl },
  };
}

function pickFirst(commaList?: string): string | null {
  if (!commaList) return null;
  const first = commaList.split(",")[0]?.trim();
  return first || null;
}

function pickHttps(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("https://") ? url : null;
}

// OBF has a deep hierarchical taxonomy ("en:cosmetics", "en:make-up",
// "en:lip-products", "en:lipsticks"). We map the leaf-most match we
// recognize to one of our BEAUTY_CATEGORIES strings. Best-effort.
const OBF_CATEGORY_MAP: Record<string, string> = {
  // Lips
  "en:lipsticks": "Lipstick",
  "en:lipstick": "Lipstick",
  "en:lip-glosses": "Lip Gloss",
  "en:lip-gloss": "Lip Gloss",
  "en:lip-liners": "Lip Liner",
  "en:lip-liner": "Lip Liner",
  "en:lip-balms": "Lip Gloss",
  // Eyes
  "en:mascaras": "Mascara",
  "en:mascara": "Mascara",
  "en:eyeliners": "Eyeliner",
  "en:eyeliner": "Eyeliner",
  "en:eye-shadows": "Eyeshadow",
  "en:eyeshadows": "Eyeshadow",
  "en:eyebrow-pencils": "Brow",
  "en:eyebrow-products": "Brow",
  // Face
  "en:foundations": "Foundation",
  "en:foundation": "Foundation",
  "en:concealers": "Concealer",
  "en:concealer": "Concealer",
  "en:powders": "Powder",
  "en:face-powders": "Powder",
  "en:blushes": "Blush",
  "en:blush": "Blush",
  "en:bronzers": "Bronzer",
  "en:highlighters": "Highlighter",
  "en:primers": "Primer",
  "en:setting-sprays": "Setting Spray",
  // Skincare
  "en:cleansers": "Cleanser",
  "en:facial-cleansers": "Cleanser",
  "en:toners": "Toner",
  "en:serums": "Serum",
  "en:facial-moisturizers": "Moisturizer",
  "en:moisturizers": "Moisturizer",
  "en:sunscreens": "SPF",
  "en:eye-creams": "Eye Cream",
  "en:masks": "Mask",
  "en:facial-masks": "Mask",
  // Tools
  "en:make-up-brushes": "Brushes",
  "en:make-up-sponges": "Sponges",
  // Fragrance
  "en:perfumes": "Perfume",
  "en:fragrances": "Perfume",
  "en:eaux-de-toilette": "Cologne",
};

function mapOBFCategory(tags: string[], freeText: string): string | null {
  for (const tag of tags) {
    if (OBF_CATEGORY_MAP[tag]) return OBF_CATEGORY_MAP[tag];
  }
  // Fallback: scan the free-text categories list for keywords.
  const lower = freeText.toLowerCase();
  if (lower.includes("lipstick")) return "Lipstick";
  if (lower.includes("lip gloss")) return "Lip Gloss";
  if (lower.includes("mascara")) return "Mascara";
  if (lower.includes("eyeliner")) return "Eyeliner";
  if (lower.includes("eyeshadow")) return "Eyeshadow";
  if (lower.includes("foundation")) return "Foundation";
  if (lower.includes("concealer")) return "Concealer";
  if (lower.includes("blush")) return "Blush";
  if (lower.includes("bronzer")) return "Bronzer";
  if (lower.includes("highlighter")) return "Highlighter";
  if (lower.includes("perfume") || lower.includes("fragrance")) return "Perfume";
  if (lower.includes("cleanser")) return "Cleanser";
  if (lower.includes("moisturizer") || lower.includes("moisturiser")) return "Moisturizer";
  return null;
}

// Pull a likely shade name out of a product name. Heuristic — looks
// for the segment after a hyphen / colon / slash, which is how most
// lipstick / blush product names format their shades:
//   "MAC Retro Matte Lipstick - Ruby Woo" → "Ruby Woo"
//   "NARS Blush in Orgasm" → "Orgasm"
//   "Charlotte Tilbury Pillow Talk" → null (no separator)
function guessShadeFromName(name: string): string | null {
  const sepMatch = name.match(/(?:\s[-–—:/]\s|\s+in\s+)(.+)$/i);
  if (sepMatch) {
    const candidate = sepMatch[1].trim();
    if (candidate.length > 0 && candidate.length < 80) return candidate;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Gemini grounded search fallback

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

async function tryGeminiSearch(code: string): Promise<{
  match: BarcodeMatch | null;
  status?: number;
  error?: string;
}> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { match: null, error: "GEMINI_API_KEY not set" };

  const prompt = [
    `What product is this barcode: ${code}?`,
    "Search the web for the matching product. Most likely a cosmetic / beauty / skincare item.",
    "Return ONE JSON object (no prose, no markdown fences):",
    "{",
    '  "name": string,            // exact product name on packaging',
    '  "brand": string | null,    // brand name only (e.g., "MAC")',
    '  "category": string | null, // best-fit short category like "Lipstick" or "Mascara"',
    '  "shadeName": string | null,// shade / color name (e.g., "Ruby Woo") if applicable',
    '  "imageUrl": string | null, // direct https product image URL if you can pin one down',
    '  "productUrl": string | null// canonical product page URL (must be real, https only)',
    "}",
    "Hard rules:",
    "- All URLs MUST be real and verified via search; never invent URLs.",
    "- Use null (not empty string) for fields you can't confidently fill.",
    "- If you can't identify the product, return: {\"name\": null}",
    "- Output ONLY the JSON object.",
  ].join(" ");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    TEXT_MODEL,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  let status: number | undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    if (!res.ok) {
      return { match: null, status, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!cleaned) return { match: null, status };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return { match: null, status, error: "non-JSON response" };
      try {
        parsed = JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        return { match: null, status, error: "JSON parse failed" };
      }
    }

    const name = pickStr(parsed.name, 200);
    if (!name) return { match: null, status };
    return {
      status,
      match: {
        name,
        brand: pickStr(parsed.brand, 80),
        category: pickStr(parsed.category, 80),
        shadeName: pickStr(parsed.shadeName, 80),
        imageUrl: pickHttpsField(parsed.imageUrl),
        productUrl: pickHttpsField(parsed.productUrl),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { match: null, status, error: message };
  }
}

function pickStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function pickHttpsField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.startsWith("https://") ? v.slice(0, 800) : null;
}
