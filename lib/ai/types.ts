// Provider-agnostic AI tagging interface. Concrete providers (Gemini,
// OpenAI, local Ollama, etc.) implement TagProvider. The route handler
// dispatches based on AI_PROVIDER env var, defaulting to "disabled" so
// no AI runs unless the user opts in.

import type { Category, Season, Activity } from "@/lib/constants";

export type TagSuggestion = {
  category?: Category;
  subType?: string;
  color?: string;
  brand?: string;
  seasons?: Season[];
  activities?: Activity[];
  notes?: string;
  // 0–1, optional. Lets the UI badge low-confidence picks.
  confidence?: number;
};

// Optional diagnostics returned alongside suggestions so the user can
// see *why* AI tagging didn't fire when the suggestion list is empty.
export type TagDebug = {
  status?: number;        // HTTP status from the provider
  rawText?: string;       // first ~400 chars of the model's response text
  error?: string;         // human-readable error message
  promptTokens?: number;
  responseTokens?: number;
};

export type TagResult = {
  suggestions: TagSuggestion;
  debug?: TagDebug;
};

export interface TagProvider {
  name: string;
  available(): boolean;
  /** Suggest tags for a single image. Should never throw past the caller. */
  tagImage(input: { image: Blob; existingBrands?: string[] }): Promise<TagResult>;
}

export class DisabledProvider implements TagProvider {
  name = "disabled";
  available() { return false; }
  async tagImage(): Promise<TagResult> { return { suggestions: {} }; }
}
