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
  size?: string;
  seasons?: Season[];
  activities?: Activity[];
  material?: string;
  careNotes?: string;
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
  /** Suggest tags. `image` is the main photo; `labelImage` is an optional
   *  brand/size/care tag close-up that the model should OCR for richer
   *  metadata. Should never throw past the caller. */
  tagImage(input: {
    image: Blob;
    labelImage?: Blob;
    existingBrands?: string[];
  }): Promise<TagResult>;
  /** Write 1-3 short, specific sentences describing the piece for the
   *  notes field. Aware of any existing metadata so it doesn't repeat
   *  the obvious. */
  describeItem?(input: {
    image: Blob;
    labelImage?: Blob;
    context?: Partial<{
      category: string;
      subType: string;
      color: string;
      brand: string;
      size: string;
      seasons: string[];
      activities: string[];
      existingNotes: string;
    }>;
  }): Promise<NotesResult>;
  /** Pick items from a closet for a free-text occasion. Returns a list of
   *  itemIds the user already owns plus an optional outfit name and
   *  reasoning. Implementations that can't do this should leave it
   *  undefined; the route handler reports it as unsupported. */
  buildOutfit?(input: {
    occasion: string;
    items: Array<{
      id: string;
      category: string;
      subType?: string | null;
      color?: string | null;
      brand?: string | null;
      seasons?: string[];
      activities?: string[];
    }>;
    /** Free-form style notes from the user — e.g. "I don't pair pink and blue".
     *  Honored unless directly contradicted by the occasion. */
    preferences?: string;
  }): Promise<OutfitSuggestion>;
  /** Curate a packing list for a trip from the user's closet. Reasons
   *  about destination climate, trip length and planned activities,
   *  picks pieces from the catalog (never invents), and returns the
   *  itemIds plus a 1-sentence reasoning and short packing tips. */
  buildPackingList?(input: {
    trip: {
      destination?: string;
      startDate?: string;
      endDate?: string;
      activities: string[];
      occasion?: string;
      notes?: string;
    };
    /** Optional per-category target counts. When provided, the model
     *  should respect them closely (off by ±1 is fine). Keys are
     *  category names (e.g. "Tops", "Underwear"); values are integer
     *  counts. The model still must only pick from `items`. */
    targets?: Record<string, number>;
    items: Array<{
      id: string;
      category: string;
      subType?: string | null;
      color?: string | null;
      brand?: string | null;
      seasons?: string[];
      activities?: string[];
    }>;
  }): Promise<PackingListSuggestion>;
  /** Suggest 4–8 activities the user is likely to do on a trip given
   *  destination + dates. Helps the user fill the activities chips
   *  without typing. Pulled from the ACTIVITIES enum where possible
   *  plus free-form ones (hiking, museum days, …). */
  suggestActivities?(input: {
    destination?: string;
    startDate?: string;
    endDate?: string;
    occasion?: string;
  }): Promise<ActivitySuggestion>;
  /** Parse a free-text closet search into structured filters. Optional —
   *  the wardrobe UI falls back to LIKE-search across notes/brand/etc.
   *  when this isn't implemented. */
  parseSearch?(input: { query: string }): Promise<SearchParseResult>;
}

export type NotesResult = {
  notes: string;
  debug?: TagDebug;
};

export type OutfitSuggestion = {
  itemIds: string[];
  name?: string;
  reasoning?: string;
  debug?: TagDebug;
};

export type PackingListSuggestion = {
  itemIds: string[];
  reasoning?: string;
  // Short freeform tips: "pack a light layer for evenings", "no umbrella
  // needed in May", etc.
  packingNotes?: string;
  debug?: TagDebug;
};

export type ActivitySuggestion = {
  // Mix of ACTIVITIES enum values and free-form strings.
  activities: string[];
  debug?: TagDebug;
};

// Parsed natural-language closet search. All fields optional; the
// caller composes the final filter from whatever the model returned.
export type SearchFilters = {
  category?: string;       // one of CATEGORIES, or undefined
  color?: string;          // one of COLOR_PALETTE names
  season?: string;         // one of SEASONS
  activity?: string;       // one of ACTIVITIES
  favoritesOnly?: boolean;
  freeText?: string;       // remainder for LIKE-search across notes etc.
};

export type SearchParseResult = {
  filters: SearchFilters;
  debug?: TagDebug;
};

export class DisabledProvider implements TagProvider {
  name = "disabled";
  available() { return false; }
  async tagImage(): Promise<TagResult> { return { suggestions: {} }; }
}
