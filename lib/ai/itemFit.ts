// AI per-item fit calculator.
//
// Given a mannequin illustration and a set of clothing items, ask
// Gemini's vision model to return per-item placement {x, y, w,
// rotation} as percentages of the canvas (1:2 portrait, x from
// left, y from top, both 0-100).
//
// The result feeds the same OutfitMiniCanvas overlay path — the
// mannequin pixels are untouched. We're just refining the slot
// defaults with item-aware coordinates.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ItemFit = {
  x: number;
  y: number;
  w: number;
  rotation: number;
};

export type FitInput = {
  mannequin: { buffer: Buffer; mime: string };
  items: Array<{
    buffer: Buffer;
    mime: string;
    category: string;
    subType: string | null;
  }>;
};

export type FitResult =
  | { ok: true; fits: ItemFit[]; modelUsed: string }
  | { ok: false; error: string };

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          x: { type: "NUMBER" },
          y: { type: "NUMBER" },
          w: { type: "NUMBER" },
          rotation: { type: "NUMBER" },
        },
        required: ["index", "x", "y", "w"],
      },
    },
  },
  required: ["items"],
};

const TEXT_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
].filter((x): x is string => !!x);

const PROMPT_HEADER = [
  "You're laying out clothing items on a fashion-illustration mannequin.",
  "Image 1 is the mannequin on a 1:2 portrait canvas.",
  "The remaining images are clothing pieces in order.",
  "",
  "For each clothing piece, return placement on the canvas as:",
  "- index: 0-based, matching input order (0 = first clothing image after the mannequin).",
  "- x: center X, 0-100 (% of canvas width). Center of body is around 50.",
  "- y: center Y, 0-100 (% of canvas height). Top of canvas is 0, bottom is 100.",
  "- w: width, 0-100 (% of canvas width).",
  "- rotation: degrees, typically 0; max ±15.",
  "",
  "Place each piece naturally on the visible body in the mannequin image:",
  "- Tops / blouses / shirts / sweaters: center horizontally, vertical center between the shoulder line and waist. Width ≈ shoulder span + 30%.",
  "- Bottoms / pants / jeans: vertical center between hip and ankle, hugging the hip width.",
  "- Shorts / mini skirts: vertical center between hip and mid-thigh.",
  "- Dresses: shoulder to mid-thigh or knee, depending on length.",
  "- Outerwear / jackets / coats: shoulder to knee, slightly wider than tops (shoulder × 1.7).",
  "- Shoes: just below the ankles, narrow (~25-30% width).",
  "- Bags: hanging at the hip or in the hand, off-center.",
  "- Belts: at the waist, narrow vertical band.",
  "- Hats / hair accessories: at the head.",
  "- Necklaces / scarves: at the collar.",
  "",
  "Adjust per piece's actual silhouette in the photo:",
  "- A cropped top is shorter than a regular top.",
  "- A maxi dress goes shoulder-to-ankle.",
  "- A long sleeve top is wider than a tank.",
  "Use the mannequin's actual body proportions you can see in the image.",
].join(" ");

export async function extractItemFits(input: FitInput): Promise<FitResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set" };

  if (input.items.length === 0) return { ok: true, fits: [], modelUsed: "n/a" };

  const itemSummary = input.items
    .map((it, i) => `Image ${i + 2}: index=${i}, ${it.subType ?? it.category}`)
    .join("; ");
  const prompt = `${PROMPT_HEADER}\n\nItem catalog: ${itemSummary}.`;

  let lastError = "No vision model reachable.";
  for (const model of TEXT_MODEL_CANDIDATES) {
    const result = await callOnce(key, model, prompt, input);
    if (result.ok) return { ok: true, fits: result.fits, modelUsed: model };
    lastError = result.error;
    if (result.status !== 404) break;
  }
  return { ok: false, error: lastError };
}

async function callOnce(
  key: string,
  model: string,
  prompt: string,
  input: FitInput,
): Promise<{ ok: true; fits: ItemFit[] } | { ok: false; error: string; status?: number }> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  parts.push({
    inlineData: {
      mimeType: input.mannequin.mime || "image/png",
      data: input.mannequin.buffer.toString("base64"),
    },
  });
  for (const it of input.items) {
    parts.push({
      inlineData: {
        mimeType: it.mime || "image/png",
        data: it.buffer.toString("base64"),
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0.0,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const e = JSON.parse(text) as { error?: { message?: string } };
      if (e.error?.message) detail = `HTTP ${res.status}: ${e.error.message}`;
    } catch {
      detail = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    }
    return { ok: false, error: detail, status: res.status };
  }

  let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Model returned non-JSON" };
  }
  const inner = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!inner) return { ok: false, error: "Empty response from model" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "Model response wasn't valid JSON" };
  }
  const r = parsed as { items?: Array<Record<string, unknown>> };
  if (!Array.isArray(r.items)) {
    return { ok: false, error: "Missing items[] in model response" };
  }

  // Build fits indexed by `index` so we can return them in input order
  // even if the model shuffled them.
  const fits: ItemFit[] = input.items.map(() => ({ x: 50, y: 50, w: 40, rotation: 0 }));
  for (const entry of r.items) {
    const i = typeof entry.index === "number" ? Math.round(entry.index) : -1;
    if (i < 0 || i >= input.items.length) continue;
    fits[i] = {
      x: clamp(numOr(entry.x, 50), 0, 100),
      y: clamp(numOr(entry.y, 50), 0, 100),
      w: clamp(numOr(entry.w, 40), 5, 100),
      rotation: clamp(numOr(entry.rotation, 0), -45, 45),
    };
  }
  return { ok: true, fits };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
