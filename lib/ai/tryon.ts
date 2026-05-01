// Composite a virtual try-on image via Gemini 2.5 Flash Image
// ("Nano Banana"). Same `:generateContent` endpoint shape used by the
// tagging/outfit-suggestion code in `provider.ts`, but requesting
// `responseModalities: ["IMAGE"]` so the response carries an inline PNG.
//
// Multi-piece photos: an outfit item's photo can show more than one
// wearable piece (e.g., a swimsuit set top+bottom photographed together,
// or a coordinated earrings + shoes "set"). The route groups items that
// share a photo into a single TryOnGarment with multiple `pieces`, and
// the prompt enumerates them so the model places each at its natural
// body location instead of treating the whole image as one garment.

import type { Slot } from "@/lib/constants";

// Bumping this constant invalidates every cached try-on by changing the
// hash inputs. Bump when the prompt template below changes meaningfully.
export const TRY_ON_PROMPT_VERSION = "v2-multipiece";

const TRY_ON_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

// Head-to-toe rendering order. Garments are described to the model in
// this sequence (using the *primary* slot of the group) so it places
// outerwear over the top, shoes below, etc.
const SLOT_ORDER: Slot[] = [
  "outerwear",
  "dress",
  "top",
  "bottom",
  "shoes",
  "bag",
  "accessory",
];

// Gemini quality degrades past ~3-4 reference images and outputs go off
// the rails near 8+. Cap *images* at 5 and drop the least visible slots
// first when the outfit is over-budget.
const MAX_GARMENTS = 5;
const DROP_PRIORITY: Slot[] = ["accessory", "bag"];

/** A single wearable piece. Multiple pieces can share one image. */
export type TryOnPiece = {
  id: string;
  slot: Slot;
  category: string;
  subType: string | null;
  color: string | null;
};

export type TryOnGarment = {
  /** PNG/JPEG buffer of the (preferably bg-removed) source image. */
  imageBuf: Buffer;
  imageMime: string;
  /** True when only the original photo (with background) was available. */
  hasBackground: boolean;
  /** Pieces visible in this image. Length >= 1. */
  pieces: TryOnPiece[];
};

export type TryOnInput = {
  mannequinBuf: Buffer;
  mannequinMime: string;
  garments: TryOnGarment[];
};

export type TryOnDebug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
};

export type TryOnResult =
  | {
      ok: true;
      pngBuffer: Buffer;
      mimeType: string;
      skippedItemIds: string[];
      debug: TryOnDebug;
    }
  | {
      ok: false;
      error: string;
      skippedItemIds: string[];
      debug: TryOnDebug;
    };

function primarySlotIndex(g: TryOnGarment): number {
  // Order by the most "central" slot present in the group — outerwear
  // beats top beats bottom beats shoes etc.
  let best = 99;
  for (const p of g.pieces) {
    const i = SLOT_ORDER.indexOf(p.slot);
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

/** Return the garments the model will actually receive, in render order. */
export function pickGarments(garments: TryOnGarment[]): {
  kept: TryOnGarment[];
  skipped: TryOnGarment[];
} {
  const ordered = [...garments].sort((a, b) => primarySlotIndex(a) - primarySlotIndex(b));

  if (ordered.length <= MAX_GARMENTS) {
    return { kept: ordered, skipped: [] };
  }

  // Drop low-priority groups first — but only if every piece in the
  // group is low-priority. A group containing both shoes and earrings
  // shouldn't be dropped just because it contains earrings.
  const kept = [...ordered];
  const skipped: TryOnGarment[] = [];
  for (const slot of DROP_PRIORITY) {
    while (kept.length > MAX_GARMENTS) {
      const idx = kept.findIndex((g) => g.pieces.every((p) => p.slot === slot));
      if (idx < 0) break;
      skipped.push(kept.splice(idx, 1)[0]);
    }
    if (kept.length <= MAX_GARMENTS) break;
  }
  while (kept.length > MAX_GARMENTS) {
    skipped.push(kept.pop()!);
  }
  return { kept, skipped };
}

function describePiece(p: TryOnPiece): string {
  const detail = [p.subType, p.color, p.category].filter(Boolean).join(", ");
  return `${p.slot.toUpperCase()} (${detail || p.category})`;
}

function describe(g: TryOnGarment, index: number): string {
  const bgWarning = g.hasBackground
    ? " (this image still has a background — extract only the garment(s), ignore any model or surroundings)"
    : "";
  if (g.pieces.length === 1) {
    return `Image ${index + 2} is the ${describePiece(g.pieces[0])}${bgWarning}.`;
  }
  const list = g.pieces.map(describePiece).join(" AND ");
  return `Image ${index + 2} contains MULTIPLE PIECES — ${list} — all visible in the same photo. Place each piece on the mannequin at its natural body position (don't treat the whole image as a single garment)${bgWarning}.`;
}

function buildPrompt(garments: TryOnGarment[]): string {
  const lines = garments.map((g, i) => describe(g, i));
  const hasMultiPiece = garments.some((g) => g.pieces.length > 1);
  return [
    "Image 1 is a neutral photorealistic mannequin standing front-facing on a plain background.",
    ...lines,
    "Render the mannequin in image 1 wearing all of the garments together as a coherent outfit, head to toe.",
    "CRITICAL CONSTRAINTS — do NOT deviate:",
    "1. Keep the mannequin's pose, body proportions, position in frame, and the plain background EXACTLY as in image 1.",
    "2. Do NOT replace the mannequin with a different person, a real model, or a different body type.",
    "3. Do NOT change the background or add a scene.",
    "4. Drape each garment naturally with realistic fit, layering (outerwear over top, top tucked or untucked appropriately), shadows, and proportion to the body.",
    "5. Shoes must sit on the feet; bottoms must connect to the waist; tops must sit on the shoulders. Do NOT float garments off the body.",
    hasMultiPiece
      ? "6. When an image contains multiple pieces (e.g., a top + bottom set, or earrings + shoes laid out together), render EACH piece separately on the body — earrings on ears, shoes on feet, top on torso, bottom on legs, etc. — not as a stacked or laid-out arrangement."
      : "6. Render each piece on its corresponding body part, not floating beside the mannequin.",
    "7. Ignore any people or models present inside images 2-N — only use the garments themselves.",
    "8. Photorealistic, soft studio lighting, full body visible from head to toe.",
    "Output a single image of the dressed mannequin.",
  ].join(" ");
}

export async function generateTryOn(input: TryOnInput): Promise<TryOnResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "GEMINI_API_KEY not set",
      skippedItemIds: [],
      debug: { error: "GEMINI_API_KEY not set" },
    };
  }
  if (input.garments.length === 0) {
    return {
      ok: false,
      error: "Outfit has no garments to render",
      skippedItemIds: [],
      debug: { error: "no garments" },
    };
  }

  const { kept, skipped } = pickGarments(input.garments);
  const skippedItemIds = skipped.flatMap((g) => g.pieces.map((p) => p.id));

  const prompt = buildPrompt(kept);

  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    {
      inlineData: {
        mimeType: input.mannequinMime || "image/png",
        data: input.mannequinBuf.toString("base64"),
      },
    },
    ...kept.map((g) => ({
      inlineData: {
        mimeType: g.imageMime || "image/png",
        data: g.imageBuf.toString("base64"),
      },
    })),
  ];

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
      temperature: 0.4,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    TRY_ON_MODEL,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  let httpStatus: number | undefined;
  let rawText = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    const responseText = await res.text();
    rawText = responseText.slice(0, 400);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = JSON.parse(responseText) as { error?: { message?: string } };
        if (err.error?.message) detail = `HTTP ${res.status}: ${err.error.message}`;
      } catch {
        detail = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
      }
      return {
        ok: false,
        error: detail,
        skippedItemIds,
        debug: { status: res.status, error: detail, rawText },
      };
    }

    const data = JSON.parse(responseText) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: `Blocked by safety filter: ${data.promptFeedback.blockReason}`,
        skippedItemIds,
        debug: { status: 200, error: data.promptFeedback.blockReason, rawText },
      };
    }

    const partsOut = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = partsOut.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const text = partsOut.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
      return {
        ok: false,
        error: `Model returned no image (finishReason=${data.candidates?.[0]?.finishReason ?? "?"}${text ? `, text=${text}` : ""})`,
        skippedItemIds,
        debug: { status: 200, error: "no image in response", rawText },
      };
    }

    const pngBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    return {
      ok: true,
      pngBuffer,
      mimeType: imagePart.inlineData.mimeType || "image/png",
      skippedItemIds,
      debug: {
        status: 200,
        rawText,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: detail,
      skippedItemIds,
      debug: { status: httpStatus, error: detail, rawText },
    };
  }
}
