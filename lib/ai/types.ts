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

export interface TagProvider {
  name: string;
  /** Whether the provider can run (env vars set, etc). */
  available(): boolean;
  /** Suggest tags for a single image. Should never throw past the caller — return {} on failure. */
  tagImage(input: { image: Blob; existingBrands?: string[] }): Promise<TagSuggestion>;
}

export class DisabledProvider implements TagProvider {
  name = "disabled";
  available() { return false; }
  async tagImage(): Promise<TagSuggestion> { return {}; }
}
