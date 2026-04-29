// Shared helpers for Gemini image-generation calls. Both the mannequin
// generator and the outfit-render generator wrap this — the only
// per-feature differences are the prompt + which images go in.
//
// Why this exists: Google's image-output preview models churn names
// constantly. A static fallback chain breaks every few weeks. Instead
// we keep a short hardcoded list (so the happy path is one HTTP call)
// and, when every candidate 404s, fetch ListModels to discover what's
// actually available on the user's key. That way the integration
// self-heals across model renames.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type Part = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export type SingleResult =
  | { ok: true; png: Buffer }
  | { ok: false; error: string; status?: number };

export type RunResult =
  | { ok: true; png: Buffer; modelUsed: string }
  | { ok: false; error: string; status?: number; tried: string[] };

// Hardcoded fallback chain — what's been seen in the wild for Gemini
// image-output. ListModels fills in anything new automatically.
export const HARDCODED_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-exp",
];

// Optional caller hook — when all hardcoded models fail, we ask Google
// what models exist on this key and try the image-capable ones.
async function discoverImageModels(key: string): Promise<string[]> {
  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(key)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const models = data.models ?? [];
    return models
      .filter(
        (m) =>
          (m.supportedGenerationMethods ?? []).includes("generateContent") &&
          typeof m.name === "string" &&
          /image/i.test(m.name) &&
          // Skip models we've never seen produce images even when listed
          // (e.g. text-only review of an image input).
          !/^models\/(?:learnlm|aqa|embed)/i.test(m.name),
      )
      .map((m) => (m.name as string).replace(/^models\//, ""));
  } catch {
    return [];
  }
}

export async function callImageOnce(
  key: string,
  model: string,
  parts: Part[],
  extraConfig: Record<string, unknown> = {},
): Promise<SingleResult> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      temperature: 0.15,
      ...extraConfig,
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
    // Treat text-only responses like a 400 so the iterator skips to
    // the next candidate — many models accept image input but only
    // emit text when not properly configured for image output.
    error: textOnly
      ? `Model returned text instead of an image: ${textOnly.slice(0, 200)}`
      : `No image in response (finishReason=${data.candidates?.[0]?.finishReason ?? "?"})`,
    status: 400,
  };
}

// Walk a candidate list, then ListModels-discovered models, until one
// returns an image. Stops on non-recoverable errors (429 quota, 5xx,
// safety blocks) so we don't burn quota on real failures.
export async function runImageWithFallback(opts: {
  key: string;
  override?: string;
  parts: Part[];
  extraConfig?: Record<string, unknown>;
}): Promise<RunResult> {
  const { key, override, parts, extraConfig } = opts;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set", tried: [] };

  const tried: string[] = [];
  let lastError = "No image-output model reachable.";
  let lastStatus: number | undefined;

  // First: the user's pin (if any), or the static chain.
  const initial = override ? [override] : HARDCODED_IMAGE_MODELS;
  for (const model of initial) {
    tried.push(model);
    const result = await callImageOnce(key, model, parts, extraConfig);
    if (result.ok) return { ok: true, png: result.png, modelUsed: model };
    lastError = result.error;
    lastStatus = result.status;
    if (result.status !== 404 && result.status !== 400) {
      return { ok: false, error: lastError, status: lastStatus, tried };
    }
  }

  // All static candidates 404/400'd. Discover what the key actually
  // has access to and try those.
  if (!override) {
    const discovered = await discoverImageModels(key);
    const fresh = discovered.filter((m) => !tried.includes(m));
    for (const model of fresh) {
      tried.push(model);
      const result = await callImageOnce(key, model, parts, extraConfig);
      if (result.ok) return { ok: true, png: result.png, modelUsed: model };
      lastError = result.error;
      lastStatus = result.status;
      if (result.status !== 404 && result.status !== 400) break;
    }
    if (discovered.length === 0) {
      lastError =
        lastError +
        " · Couldn't list models from your key — confirm the API key has access to image-generation models.";
    } else if (fresh.length === 0) {
      lastError = lastError + ` · ListModels found no new image-capable models.`;
    }
  }

  return {
    ok: false,
    error: `${lastError}${tried.length > 1 ? ` (tried: ${tried.join(", ")})` : ""}`,
    status: lastStatus,
    tried,
  };
}
