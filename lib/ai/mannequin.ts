// Generates a stylized fashion-illustration mannequin from a user's
// photo using Gemini's image-out model. Wraps lib/ai/imageGen.ts —
// see that file for the fallback / discovery logic.

import { runImageWithFallback, type Part } from "./imageGen";

export type GenerateResult =
  | { ok: true; png: Buffer; modelUsed: string }
  | { ok: false; error: string; status?: number; tried: string[] };

const PROMPT = [
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

  const parts: Part[] = [
    { text: PROMPT },
    {
      inlineData: {
        mimeType: source.mime || "image/jpeg",
        data: source.buffer.toString("base64"),
      },
    },
  ];

  return runImageWithFallback({
    key,
    override: process.env.GEMINI_IMAGE_MODEL,
    parts,
  });
}
