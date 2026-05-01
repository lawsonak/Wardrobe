// Persistence for the dashboard's "Today's suggestion" card.
//
// One JSON file per user at data/uploads/<userId>/todays-suggestion.json
// holding the AI's product pick. Like the daily outfit pick, the saved
// record carries today's ISO date and `readSavedSuggestion` returns
// null when the calendar day rolls over so the card naturally
// re-prompts the next morning.

import { promises as fs } from "node:fs";
import path from "node:path";
import { todayISO } from "@/lib/dates";
import type { StyleSuggestion } from "@/lib/ai/styleSuggestion";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const FILE = "todays-suggestion.json";

export type SavedSuggestion = StyleSuggestion & {
  date: string;       // YYYY-MM-DD
  sources: string[];  // grounding URLs surfaced for traceability
};

export async function readSavedSuggestion(userId: string): Promise<SavedSuggestion | null> {
  if (!userId) return null;
  try {
    const raw = await fs.readFile(path.join(UPLOAD_ROOT, userId, FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SavedSuggestion>;
    if (!parsed?.date || parsed.date !== todayISO()) return null;
    if (typeof parsed.productName !== "string" || typeof parsed.productUrl !== "string") return null;
    return {
      date: parsed.date,
      productName: parsed.productName,
      productUrl: parsed.productUrl,
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : "",
      category: typeof parsed.category === "string" ? parsed.category : null,
      estimatedPrice: typeof parsed.estimatedPrice === "string" ? parsed.estimatedPrice : null,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      imageUrl: typeof parsed.imageUrl === "string" ? parsed.imageUrl : null,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export async function writeSavedSuggestion(
  userId: string,
  saved: SavedSuggestion,
): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, FILE), JSON.stringify(saved, null, 2));
}

export async function clearSavedSuggestion(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, userId, FILE));
  } catch {
    /* nothing to clear */
  }
}
