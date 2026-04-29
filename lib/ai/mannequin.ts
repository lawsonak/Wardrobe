// Generates a stylized fashion-illustration mannequin from a user's
// photo using Gemini's image-out model (Nano Banana / Flash Image).
//
// We keep this separate from the main `lib/ai/provider.ts` because:
//   - Image generation uses a different model than text/vision tagging.
//   - It's optional, off by default, and degrades gracefully — if the
//     call fails, the upload UI surfaces the error and the user keeps
//     the default silhouette.
//
// Model name is configurable via GEMINI_IMAGE_MODEL; default is the
// current image-output Flash preview.

const DEFAULT_MODEL = "gemini-2.5-flash-image-preview";

const PROMPT = [
  "Generate a clean editorial fashion-illustration croquis (mannequin).",
  "Match the person's hair color, hair style, skin tone, and approximate body type.",
  "Style: soft watercolor washes with gentle pencil outlines, on a plain warm cream background — like a high-end fashion sketch.",
  "Pose: standing, facing forward, arms slightly out from body, neutral expression, full body visible head to toe.",
  "Clothing: dressed in simple form-fitting neutral-colored undergarments only (so outfits can be layered on top later).",
  "Composition: subject centered, head near top, feet near bottom, with comfortable margin around the figure.",
  "Important: produce an illustration, not a photo — abstract enough to be charming, specific enough to feel like the person.",
].join(" ");

export type GenerateResult =
  | { ok: true; png: Buffer }
  | { ok: false; error: string; status?: number };

export async function generateMannequinImage(
  source: { buffer: Buffer; mime: string },
): Promise<GenerateResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set" };

  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
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
      // Some SDK variants want responseModalities, others responseMimeType.
      // Both are tolerated; the model picks the right one.
      responseModalities: ["IMAGE"],
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

  // The model occasionally returns text-only when it refuses or when a
  // model name without image output is used. Surface that explicitly.
  const textOnly = parts.find((p) => p.text)?.text;
  return {
    ok: false,
    error: textOnly
      ? `Model returned text instead of an image: ${textOnly.slice(0, 200)}`
      : `No image in response (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
  };
}
