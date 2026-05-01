// Convert a user's photo into a stylized fashion-illustration mannequin
// via Gemini 2.5 Flash Image. The result becomes the canonical reference
// image fed to the try-on compose step in `lib/ai/tryon.ts`, replacing
// the global `public/mannequin/base.png` for that user.
//
// We deliberately ask the model to drop facial details and keep the
// figure neutral — Gemini's identity preservation is shaky and the goal
// is "a mannequin that looks like the user's body type and proportions",
// not a portrait.

const TRY_ON_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const PROMPT = [
  "Turn the person in this photo into a neutral photorealistic dress-form mannequin.",
  "Match their body type, proportions, height, and overall posture, but:",
  "- Pose the mannequin standing front-facing, arms slightly away from torso, legs together.",
  "- Use a matte beige fabric finish for the entire figure (no skin tone).",
  "- Remove all facial features — no eyes, mouth, nose, eyebrows, or hair.",
  "- Remove all clothing the person is wearing.",
  "- Place against a plain off-white seamless background with soft even studio lighting.",
  "- Frame the mannequin head to toe, portrait 9:16, head fully visible at the top, feet fully visible at the bottom.",
  "Output a single image of the mannequin. Do not output text.",
].join(" ");

export type MannequinResult =
  | { ok: true; pngBuffer: Buffer; mimeType: string; debug: Debug }
  | { ok: false; error: string; debug: Debug };

type Debug = {
  status?: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  responseTokens?: number;
};

export async function generateMannequinFromPhoto(input: {
  photo: Buffer;
  mime: string;
}): Promise<MannequinResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { ok: false, error: "GEMINI_API_KEY not set", debug: { error: "GEMINI_API_KEY not set" } };
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          {
            inlineData: {
              mimeType: input.mime || "image/jpeg",
              data: input.photo.toString("base64"),
            },
          },
        ],
      },
    ],
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
      return { ok: false, error: detail, debug: { status: res.status, error: detail, rawText } };
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
        debug: { status: 200, error: "no image in response", rawText },
      };
    }

    return {
      ok: true,
      pngBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType: imagePart.inlineData.mimeType || "image/png",
      debug: {
        status: 200,
        rawText,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: detail, debug: { status: httpStatus, error: detail, rawText } };
  }
}
