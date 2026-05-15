// Phase E: rough body-measurement estimate from photos.
//
// NOT a metric anthropometry model — this is a single Gemini vision
// call. Realistic accuracy is ±1-3in on circumferences. The result
// is a DRAFT the user reviews and edits in the form; it is never
// auto-saved and the photos are never written to disk (the route
// holds them in memory, sends, and drops them).
//
// Accuracy levers baked into the prompt:
//   - the user's tape-measured HEIGHT is the scale anchor (a photo
//     has no inherent scale; height spans the frame so its relative
//     pixel error is small)
//   - front + optional true-side photo (front = widths, side =
//     depths; circumferences come from a width+depth ellipse fit —
//     the main error source, hence the soft expectations)
//   - the prompt tells the model fitted clothing is assumed and to
//     reason from the silhouette
//
// Returns numbers IN INCHES; the caller converts to the user's unit
// before pre-filling the form.

import { fetchWithTimeout } from "@/lib/fetchRetry";

const MODEL = process.env.GEMINI_TAG_MODEL || "gemini-2.5-pro";
const TIMEOUT_MS = 60_000;

export type EstimateInput = {
  front: { buf: Buffer; mime: string };
  side?: { buf: Buffer; mime: string } | null;
  /** Tape-measured height in inches — the scale anchor. Required. */
  heightInches: number;
};

export type EstimateDraft = {
  bust?: number;
  waist?: number;
  hips?: number;
  shoulder?: number;
  sleeve?: number;
  inseam?: number;
  /** Free-text silhouette descriptor, not an archetype label. */
  shape?: string;
  /** 0–1 — surfaced so the UI can caveat low-confidence drafts. */
  confidence?: number;
};

export type EstimateResult =
  | { ok: true; draft: EstimateDraft; debug: Record<string, unknown> }
  | { ok: false; error: string; debug: Record<string, unknown> };

const SCHEMA = {
  type: "OBJECT",
  properties: {
    bust: { type: "NUMBER", nullable: true },
    waist: { type: "NUMBER", nullable: true },
    hips: { type: "NUMBER", nullable: true },
    shoulder: { type: "NUMBER", nullable: true },
    sleeve: { type: "NUMBER", nullable: true },
    inseam: { type: "NUMBER", nullable: true },
    shape: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
};

export async function estimateMeasurements(
  input: EstimateInput,
): Promise<EstimateResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { ok: false, error: "GEMINI_API_KEY not set", debug: { error: "no key" } };
  }
  const h = input.heightInches;
  if (!Number.isFinite(h) || h < 36 || h > 90) {
    return {
      ok: false,
      error: "A tape-measured height is required to scale the estimate.",
      debug: { error: "bad height" },
    };
  }

  const prompt = [
    "You are estimating a person's body measurements from photos for a wardrobe app.",
    `The person's true standing height is ${h} inches. Use this as the absolute scale reference — measure everything else in pixels relative to the full standing height, then convert to inches.`,
    input.side
      ? "You have a front photo and a true side (90°) photo. Use the front for widths (shoulder, hip, waist width) and the side for depths (bust/belly depth); estimate each circumference from the width+depth as an ellipse."
      : "You have a single front photo. Estimate circumferences from the visible width plus a typical depth-to-width ratio for that body type. Be conservative — single-photo circumferences are rougher.",
    "Assume the person is wearing fitted clothing; read the true silhouette outline, not loose fabric.",
    "Return inches for every numeric field:",
    "  - bust: fullest chest circumference",
    "  - waist: natural waist circumference (narrowest point of the torso)",
    "  - hips: fullest seat circumference",
    "  - shoulder: straight across the back, shoulder point to shoulder point",
    "  - sleeve: shoulder point down a slightly bent arm to the wrist",
    "  - inseam: crotch to floor along the inner leg",
    "  - shape: ONE short descriptive phrase of the silhouette — where volume sits, waist definition, proportional balance (e.g. \"defined waist, volume at hips, slightly long torso\"). NOT a single archetype label. Keep under 140 chars.",
    "  - confidence: 0-1, your honest overall confidence given photo quality, pose, and clothing.",
    "Hard rules:",
    "- These are estimates. Don't pretend tailor precision. If the pose, framing, or clothing makes a field unreliable, return null for that field rather than guessing wildly.",
    "- Numbers must be physically plausible for the stated height.",
    "- Output ONLY the JSON object.",
  ].join("\n");

  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    { inlineData: { mimeType: input.front.mime || "image/jpeg", data: input.front.buf.toString("base64") } },
  ];
  if (input.side) {
    parts.push({
      inlineData: {
        mimeType: input.side.mime || "image/jpeg",
        data: input.side.buf.toString("base64"),
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0.1,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    MODEL,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      TIMEOUT_MS,
    );
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const e = JSON.parse(text) as { error?: { message?: string } };
        if (e.error?.message) detail = `HTTP ${res.status}: ${e.error.message}`;
      } catch {
        detail = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      }
      return { ok: false, error: detail, debug: { status: res.status, rawText: text.slice(0, 400) } };
    }
    const data = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!out) return { ok: false, error: "Empty response", debug: { rawText: text.slice(0, 400) } };
    const cleaned = out.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Model response wasn't valid JSON", debug: { rawText: cleaned.slice(0, 400) } };
    }

    const n = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) && v > 0
        ? Math.round(v * 10) / 10
        : undefined;
    const draft: EstimateDraft = {
      bust: n(parsed.bust),
      waist: n(parsed.waist),
      hips: n(parsed.hips),
      shoulder: n(parsed.shoulder),
      sleeve: n(parsed.sleeve),
      inseam: n(parsed.inseam),
      shape:
        typeof parsed.shape === "string" && parsed.shape.trim()
          ? parsed.shape.trim().slice(0, 240)
          : undefined,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : undefined,
    };
    return { ok: true, draft, debug: { status: 200, rawText: cleaned.slice(0, 400) } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      debug: { error: String(err) },
    };
  }
}
