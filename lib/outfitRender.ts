// Path lookup for the AI-rendered "outfit on mannequin" image.
// Cached at data/uploads/{userId}/outfit-{outfitId}.png. Convention-
// over-config (no DB column) — presence of the file is the single
// source of truth.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export function renderFilename(outfitId: string): string {
  return `outfit-${outfitId}.png`;
}

export async function getOutfitRender(
  userId: string,
  outfitId: string,
): Promise<{ url: string | null }> {
  if (!userId || !outfitId) return { url: null };
  const abs = path.join(UPLOAD_ROOT, userId, renderFilename(outfitId));
  try {
    const stat = await fs.stat(abs);
    return {
      url: `/api/uploads/${userId}/${renderFilename(outfitId)}?v=${stat.mtimeMs.toFixed(0)}`,
    };
  } catch {
    return { url: null };
  }
}

// Bulk variant for the /outfits list — keeps a single fs scan per user
// instead of one stat per outfit.
export async function getOutfitRendersFor(
  userId: string,
  outfitIds: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (!userId || outfitIds.length === 0) return out;
  const dir = path.join(UPLOAD_ROOT, userId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    for (const id of outfitIds) out[id] = null;
    return out;
  }
  const entrySet = new Set(entries);
  for (const id of outfitIds) {
    const fname = renderFilename(id);
    if (!entrySet.has(fname)) {
      out[id] = null;
      continue;
    }
    try {
      const stat = await fs.stat(path.join(dir, fname));
      out[id] = `/api/uploads/${userId}/${fname}?v=${stat.mtimeMs.toFixed(0)}`;
    } catch {
      out[id] = null;
    }
  }
  return out;
}

export async function saveOutfitRender(
  userId: string,
  outfitId: string,
  png: Buffer,
): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, renderFilename(outfitId)), png);
}

export async function clearOutfitRender(
  userId: string,
  outfitId: string,
): Promise<void> {
  const abs = path.join(UPLOAD_ROOT, userId, renderFilename(outfitId));
  try {
    await fs.unlink(abs);
  } catch {
    /* nothing to clear */
  }
}
