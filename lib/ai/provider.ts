// Pick a tagging provider based on env. We don't ship a real provider —
// callers wire one in by setting AI_PROVIDER + the relevant API key. Keeps
// secrets out of the bundle and lets the user opt in deliberately.

import { DisabledProvider, type TagProvider } from "./types";

let _cached: TagProvider | null = null;

export function getProvider(): TagProvider {
  if (_cached) return _cached;
  const which = (process.env.AI_PROVIDER ?? "").toLowerCase();
  switch (which) {
    case "gemini":
      _cached = makeGemini();
      break;
    case "openai":
      _cached = makeOpenAI();
      break;
    default:
      _cached = new DisabledProvider();
  }
  return _cached;
}

// Stub providers — real implementations would call out to the respective
// API. We keep them as no-ops so the interface is stable but no network
// traffic happens unless the user replaces these.

function makeGemini(): TagProvider {
  const key = process.env.GEMINI_API_KEY;
  return {
    name: "gemini",
    available: () => !!key,
    async tagImage() {
      // TODO: call Gemini multimodal endpoint with the image.
      return {};
    },
  };
}

function makeOpenAI(): TagProvider {
  const key = process.env.OPENAI_API_KEY;
  return {
    name: "openai",
    available: () => !!key,
    async tagImage() {
      // TODO: call OpenAI Responses API with image input.
      return {};
    },
  };
}
