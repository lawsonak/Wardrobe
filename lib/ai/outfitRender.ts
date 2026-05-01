// AI composition of an "outfit on mannequin" image. Sends the
// mannequin illustration + bg-removed item cutouts to Gemini's
// image-output model and asks for a single composed image.
// Wraps lib/ai/imageGen.ts — see that file for the fallback /
// discovery logic.

import { runImageWithFallback, type Part } from "./imageGen";

export type ItemForRender = {
  buffer: Buffer;
  mime: string;
  category: string;
  subType: string | null;
  color: string | null;
};

export type RenderResult =
  | { ok: true; png: Buffer; modelUsed: string }
  | { ok: false; error: string; status?: number; tried: string[] };

export async function renderOutfit(input: {
  mannequin: { buffer: Buffer; mime: string };
  items: ItemForRender[];
}): Promise<RenderResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set", tried: [] };

  const itemSummary = input.items
    .map((it, i) => {
      const label = it.subType ?? it.category;
      const color = it.color ? ` (${it.color})` : "";
      return `Image ${i + 2}: ${label}${color}`;
    })
    .join("; ");

  const prompt = [
    "TASK: Take Image 1 (the model) and add the clothing pieces from Images 2-N onto her, producing one composed illustration of her wearing the outfit.",
    `Item images: ${itemSummary}.`,
    "",
    "ABSOLUTE PRESERVATION (Image 1 is the source of truth — do NOT alter):",
    "- The model's face: face shape, jawline, eye color, eye shape, eyebrows, nose, lips, chin — IDENTICAL to Image 1.",
    "- The model's hair: color, length, texture, parting, style — IDENTICAL to Image 1.",
    "- The model's skin tone — IDENTICAL to Image 1.",
    "- The model's body: weight, height, proportions, build — IDENTICAL to Image 1. Do not slim, lengthen, or stylize the figure.",
    "- The model's pose, stance, and arm position — IDENTICAL to Image 1.",
    "- The illustration style and background of Image 1 — IDENTICAL.",
    "Treat Image 1 as a fixed canvas. Your only job is to add clothing on top.",
    "",
    "CLOTHING PLACEMENT:",
    "- Place each garment on the body anatomically: tops on torso, bottoms on legs, shoes on feet, outerwear over tops, etc.",
    "- Correct scale and natural drape against this specific body.",
    "- Preserve each garment's color, pattern, fabric, and silhouette faithfully — do not invent details or swap colors.",
    "- Re-illustrate the garments in the same soft pencil + watercolor style as Image 1 so the composition feels cohesive (not a photo collage).",
    "",
    "OUTPUT:",
    "- One illustration. Full body, head to toe, centered with comfortable margin.",
    "- The person in the output must be unmistakably the same person as in Image 1 — same face, same hair, same body. Only the clothing is new.",
  ].join(" ");

  const parts: Part[] = [{ text: prompt }];
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

  return runImageWithFallback({
    key,
    override: process.env.GEMINI_IMAGE_MODEL,
    parts,
  });
}
