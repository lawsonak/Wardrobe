// Persistence for the dashboard's "Plan today's look" card.
//
// Stored on disk per user at data/uploads/{userId}/todays-outfit.json.
// Auto-expires when the calendar day rolls over — `readSavedPick`
// returns null if the saved date doesn't match today's ISO date, so
// the card naturally re-prompts on the next morning.

import { promises as fs } from "node:fs";
import path from "node:path";
import { todayISO } from "@/lib/wear";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const FILE = "todays-outfit.json";

export type SavedPickItemLayout = {
  itemId: string;
  x: number;
  y: number;
  w: number;
  rotation: number;
};

export type SavedPick = {
  date: string;       // YYYY-MM-DD
  itemIds: string[];
  name: string | null;
  reasoning: string | null;
  weather: string | null;
  /** Per-item AI-computed placement, when the fit pass succeeded.
   *  When absent or empty, the canvas falls back to landmark-based
   *  slot defaults. */
  layout?: SavedPickItemLayout[];
};

export async function readSavedPick(userId: string): Promise<SavedPick | null> {
  if (!userId) return null;
  try {
    const raw = await fs.readFile(path.join(UPLOAD_ROOT, userId, FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SavedPick>;
    if (!parsed?.date || !Array.isArray(parsed.itemIds)) return null;
    if (parsed.date !== todayISO()) return null;
    const layout = Array.isArray(parsed.layout)
      ? parsed.layout.filter(
          (l): l is SavedPickItemLayout =>
            !!l &&
            typeof (l as SavedPickItemLayout).itemId === "string" &&
            typeof (l as SavedPickItemLayout).x === "number" &&
            typeof (l as SavedPickItemLayout).y === "number" &&
            typeof (l as SavedPickItemLayout).w === "number",
        )
      : undefined;
    return {
      date: parsed.date,
      itemIds: parsed.itemIds.filter((x): x is string => typeof x === "string"),
      name: typeof parsed.name === "string" ? parsed.name : null,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : null,
      weather: typeof parsed.weather === "string" ? parsed.weather : null,
      layout,
    };
  } catch {
    return null;
  }
}

export async function writeSavedPick(userId: string, pick: SavedPick): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, FILE), JSON.stringify(pick, null, 2));
}

export async function clearSavedPick(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, userId, FILE));
  } catch {
    /* nothing to clear */
  }
}
