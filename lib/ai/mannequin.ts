// Generates a stylized fashion-illustration mannequin from a user's
// photo using Gemini's image-out model.
//
// Model selection: Google's image-output preview models have churned
// a lot — names rename, get gated, and disappear. Rather than pin a
// single model, we try a fallback chain. Override with
// GEMINI_IMAGE_MODEL to force a specific one.

export type GenerateResult =
  | { ok: true; png: Buffer; modelUsed: string }
  | { ok: false; error: string; status?: number; tried: string[] };

const FALLBACK_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-exp",
];

const PROMPT = [
  // Identity preservation comes first — every later instruction is
  // conditional on faithfulness to the source photo.
  "TASK: Faithfully illustrate the specific person in this photo. This is a portrait — not a generic mannequin.",
  "PRESERVE EXACTLY (do not alter, idealize, slim, age, or stylize):",
  "- Face: face shape, jawline, cheekbones, eye color, eye shape and spacing, eyebrow shape, nose shape, lip shape, chin.",
  "- Hair: exact color, length, texture, hairline, parting, and style as in the photo.",
  "- Skin tone and undertone exactly as in the photo.",
  "- Body: weight, height, proportions, shoulder width, hip width, and overall build — do not thin, lengthen, or 'fashion-model' the figure.",
  "- Approximate age as visible in the photo.",
  "POSE / FRAMING:",
  "- Standing, facing forward, arms slightly out from body, neutral expression, full body visible head to toe, centered, with small margin.",
  "CLOTHING:",
  "- Plain, form-fitting neutral undergarments only (so outfits can layer on top later).",
  "STYLE (apply ONLY to rendering, NEVER to features):",
  "- Soft pencil outlines with light watercolor washes, on a plain warm cream background.",
  "- The watercolor is just the medium — features themselves must remain recognizably this person.",
  "OUTPUT:",
  "- One illustration. No text. No background scenery. No props.",
  "- The result should look unmistakably like the person in the photo, drawn in soft watercolor.",
].join(" ");

export async function generateMannequinImage(
  source: { buffer: Buffer; mime: string },
): Promise<GenerateResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set", tried: [] };

  // If the user pinned a model, try only that. Otherwise walk the
  // fallback chain and stop at the first one that yields an image.
  const override = process.env.GEMINI_IMAGE_MODEL;
  const candidates = override ? [override] : FALLBACK_MODELS;

  const tried: string[] = [];
  let lastError = "No image-output model reachable.";
  let lastStatus: number | undefined;

  for (const model of candidates) {
    tried.push(model);
    const result = await callOnce(key, model, source);
    if (result.ok) return { ok: true, png: result.png, modelUsed: model };
    lastError = result.error;
    lastStatus = result.status;
    // 404 / 400 → model unavailable to this key, try the next one.
    // Other errors (429, 5xx, safety blocks) → stop early so we don't
    // burn through quota on a real failure.
    if (result.status !== 404 && result.status !== 400) break;
  }

  return {
    ok: false,
    error: `${lastError}${tried.length > 1 ? ` (tried: ${tried.join(", ")})` : ""}`,
    status: lastStatus,
    tried,
  };
}

type SingleResult =
  | { ok: true; png: Buffer }
  | { ok: false; error: string; status?: number };

async function callOnce(
  key: string,
  model: string,
  source: { buffer: Buffer; mime: string },
): Promise<SingleResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          {
            inlineData: {
              mimeType: source.mime || "image/jpeg",
              data: source.buffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      // Some image-out models require this; others ignore it. Setting
      // it is harmless either way.
      responseModalities: ["IMAGE"],
      // Lower variance so the model leans on the source photo instead
      // of "improving" it. Image-out preview models accept this
      // inconsistently — harmless when ignored.
      temperature: 0.15,
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

  let data: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Model returned non-JSON response" };
  }

  if (data.promptFeedback?.blockReason) {
    return { ok: false, error: `Blocked by safety filter: ${data.promptFeedback.blockReason}` };
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      try {
        return { ok: true, png: Buffer.from(inline.data, "base64") };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // The model returned text-only — usually a refusal or a model that
  // doesn't actually support image output. Caller treats this as a
  // soft failure and tries the next candidate.
  const textOnly = parts.find((p) => p.text)?.text;
  return {
    ok: false,
    error: textOnly
      ? `Model returned text instead of an image: ${textOnly.slice(0, 200)}`
      : `No image in response (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
    // Treat as 400-like so the caller skips to the next candidate.
    status: 400,
  };
}
