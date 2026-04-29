// Extracts anatomical landmark positions from a mannequin illustration
// using Gemini's vision + structured-output (JSON mode).
//
// The result is a set of percentages of the image dimensions (0-100,
// Y from top, X from left). The StyleCanvas uses these to compute the
// default position/size for every clothing slot — so items snap to
// the *actual* shoulders/waist/hips of the user's specific mannequin
// instead of the generic slot defaults that were tuned for the SVG
// silhouette.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type Landmarks = {
  /** Top of the head (lowest Y%). */
  headTopY: number;
  /** Bottom of the chin / top of the neck. */
  chinY: number;
  /** Y of the shoulder line. */
  shoulderY: number;
  /** Y of the natural waist. */
  waistY: number;
  /** Y of the hip line. */
  hipY: number;
  /** Y of the knees. */
  kneeY: number;
  /** Y of the ankles. */
  ankleY: number;
  /** X of the leftmost (viewer-left) shoulder edge. */
  leftShoulderX: number;
  /** X of the rightmost shoulder edge. */
  rightShoulderX: number;
  /** X of the left hip edge. */
  leftHipX: number;
  /** X of the right hip edge. */
  rightHipX: number;
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    headTopY: { type: "NUMBER" },
    chinY: { type: "NUMBER" },
    shoulderY: { type: "NUMBER" },
    waistY: { type: "NUMBER" },
    hipY: { type: "NUMBER" },
    kneeY: { type: "NUMBER" },
    ankleY: { type: "NUMBER" },
    leftShoulderX: { type: "NUMBER" },
    rightShoulderX: { type: "NUMBER" },
    leftHipX: { type: "NUMBER" },
    rightHipX: { type: "NUMBER" },
  },
  required: [
    "headTopY", "chinY", "shoulderY", "waistY", "hipY", "kneeY", "ankleY",
    "leftShoulderX", "rightShoulderX", "leftHipX", "rightHipX",
  ],
};

const PROMPT = [
  "You are calibrating a fashion app's outfit canvas.",
  "Return the position of anatomical landmarks on this mannequin illustration.",
  "All values are percentages of the image dimensions (0-100).",
  "Y is measured from the TOP of the image (0 = top edge, 100 = bottom edge).",
  "X is measured from the LEFT of the image (0 = left edge, 100 = right edge).",
  "Be precise — these values drive how clothing items get placed on the figure.",
  "Required points:",
  "- headTopY: the very top of the head/hair.",
  "- chinY: the bottom of the chin (top of neck).",
  "- shoulderY: the height of the shoulder line.",
  "- waistY: the natural waist (narrowest point of torso).",
  "- hipY: the widest point of the hips.",
  "- kneeY: the height of the knees.",
  "- ankleY: the height of the ankles (just above the feet).",
  "- leftShoulderX / rightShoulderX: the outer edges of the shoulders. From the viewer's perspective, leftShoulderX is to the LEFT (smaller X), rightShoulderX is to the RIGHT.",
  "- leftHipX / rightHipX: the outer edges of the hips, same convention.",
].join(" ");

export type LandmarkResult =
  | { ok: true; landmarks: Landmarks; modelUsed: string }
  | { ok: false; error: string };

const TEXT_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
].filter((x): x is string => !!x);

export async function extractLandmarks(
  source: { buffer: Buffer; mime: string },
): Promise<LandmarkResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set" };

  let lastError = "No vision model reachable.";
  for (const model of TEXT_MODEL_CANDIDATES) {
    const result = await callOnce(key, model, source);
    if (result.ok) return { ok: true, landmarks: result.landmarks, modelUsed: model };
    lastError = result.error;
    // 404 → try next; everything else stops here so we don't burn quota.
    if (result.status !== 404) break;
  }
  return { ok: false, error: lastError };
}

async function callOnce(
  key: string,
  model: string,
  source: { buffer: Buffer; mime: string },
): Promise<{ ok: true; landmarks: Landmarks } | { ok: false; error: string; status?: number }> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          {
            inlineData: {
              mimeType: source.mime || "image/png",
              data: source.buffer.toString("base64"),
            },
          },
        ],
      },
    ],
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
    return { ok: false, error: "Model returned non-JSON response" };
  }
  const inner = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!inner) return { ok: false, error: "Empty response from model" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "Model response wasn't valid JSON" };
  }
  const r = parsed as Record<string, unknown>;
  const num = (k: string): number | null =>
    typeof r[k] === "number" && isFinite(r[k] as number) ? clamp(r[k] as number, 0, 100) : null;

  const required: Array<keyof Landmarks> = [
    "headTopY", "chinY", "shoulderY", "waistY", "hipY", "kneeY", "ankleY",
    "leftShoulderX", "rightShoulderX", "leftHipX", "rightHipX",
  ];
  const out: Partial<Landmarks> = {};
  for (const k of required) {
    const v = num(k);
    if (v === null) return { ok: false, error: `Missing field: ${k}` };
    out[k] = v;
  }
  return { ok: true, landmarks: out as Landmarks };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
