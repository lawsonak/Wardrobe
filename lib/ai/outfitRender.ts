// AI composition of an "outfit on mannequin" image. Sends the
// mannequin illustration + bg-removed item cutouts to Gemini's
// image-output model and asks for a single composed image.
//
// Reuses the same fallback chain pattern as lib/ai/mannequin.ts — names
// for image-out preview models churn, so we try several until one
// returns an image.

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

const FALLBACK_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
];

export async function renderOutfit(input: {
  mannequin: { buffer: Buffer; mime: string };
  items: ItemForRender[];
}): Promise<RenderResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set", tried: [] };

  const override = process.env.GEMINI_IMAGE_MODEL;
  const candidates = override ? [override] : FALLBACK_MODELS;

  const tried: string[] = [];
  let lastError = "No image-output model reachable.";
  let lastStatus: number | undefined;

  for (const model of candidates) {
    tried.push(model);
    const result = await callOnce(key, model, input);
    if (result.ok) return { ok: true, png: result.png, modelUsed: model };
    lastError = result.error;
    lastStatus = result.status;
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
  input: { mannequin: { buffer: Buffer; mime: string }; items: ItemForRender[] },
): Promise<SingleResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  // Build the parts array: prompt → mannequin → labelled item images.
  const parts: Array<Record<string, unknown>> = [];

  const itemSummary = input.items
    .map((it, i) => {
      const label = it.subType ?? it.category;
      const color = it.color ? ` (${it.color})` : "";
      return `Image ${i + 2}: ${label}${color}`;
    })
    .join("; ");

  const prompt = [
    "You are styling a personal wardrobe outfit illustration.",
    "Image 1 is the model — a fashion-illustration mannequin in soft watercolor style.",
    `The remaining images are individual clothing pieces from her closet (${itemSummary}).`,
    "Generate a single illustration of the model wearing all of these pieces together.",
    "Preserve the model's exact face, hair, skin tone, and pose.",
    "Match the model's existing illustration style — soft watercolor washes, pencil outlines, plain warm cream background.",
    "Place the clothing on the body as if styled in real life: correct scale, natural drape, layered properly (e.g. outerwear over tops, bottoms below tops, shoes on feet).",
    "Re-illustrate the clothing pieces in the same watercolor style as the model so the composition feels cohesive — not a photo collage.",
    "Keep the original colors, patterns, and silhouettes of the clothing pieces faithfully.",
    "Composition: full body, head to toe, centered, with comfortable margin.",
  ].join(" ");

  parts.push({ text: prompt });
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

  const respParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of respParts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      try {
        return { ok: true, png: Buffer.from(inline.data, "base64") };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  const textOnly = respParts.find((p) => p.text)?.text;
  return {
    ok: false,
    error: textOnly
      ? `Model returned text instead of an image: ${textOnly.slice(0, 200)}`
      : `No image in response (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
    status: 400,
  };
}
