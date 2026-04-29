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
      // Same low-variance setting as the mannequin generator — lean
      // hard on the input images instead of "improving" them.
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
