// Server-only helpers for the per-user "custom mannequin" feature.
// We store the AI-rendered illustration on disk under the user's
// upload directory and serve it via the existing /api/uploads route.
//
// Two files per user:
//   data/uploads/{userId}/mannequin.png        — rendered illustration
//   data/uploads/{userId}/mannequin-source.<ext> — original photo (kept
//       so "Regenerate" can re-run without re-uploading)
//
// Convention-over-config means no DB column or cookie is needed; the
// presence of mannequin.png on disk *is* the user's choice.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
export const MANNEQUIN_FILENAME = "mannequin.png";
export const MANNEQUIN_SOURCE_PREFIX = "mannequin-source";

export type MannequinInfo = {
  /** Path served via /api/uploads/<rel> when present, else null. */
  url: string | null;
  hasSource: boolean;
};

export async function getMannequinForUser(userId: string): Promise<MannequinInfo> {
  if (!userId) return { url: null, hasSource: false };
  const dir = path.join(UPLOAD_ROOT, userId);
  const renderedAbs = path.join(dir, MANNEQUIN_FILENAME);
  let url: string | null = null;
  try {
    await fs.access(renderedAbs);
    // Cache-bust on file mtime so a regeneration shows up immediately.
    const stat = await fs.stat(renderedAbs);
    url = `/api/uploads/${userId}/${MANNEQUIN_FILENAME}?v=${stat.mtimeMs.toFixed(0)}`;
  } catch {
    /* not present */
  }

  let hasSource = false;
  try {
    const entries = await fs.readdir(dir);
    hasSource = entries.some((e) => e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`));
  } catch {
    /* dir may not exist yet */
  }
  return { url, hasSource };
}

export async function findSourcePath(userId: string): Promise<string | null> {
  if (!userId) return null;
  const dir = path.join(UPLOAD_ROOT, userId);
  try {
    const entries = await fs.readdir(dir);
    const match = entries.find((e) => e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export async function clearMannequinFiles(userId: string): Promise<void> {
  if (!userId) return;
  const dir = path.join(UPLOAD_ROOT, userId);
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((e) => e === MANNEQUIN_FILENAME || e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`))
        .map((e) => fs.unlink(path.join(dir, e)).catch(() => null)),
    );
  } catch {
    /* nothing to clear */
  }
}

export async function saveSourcePhoto(userId: string, file: Blob, mime: string): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  // Wipe any prior source so we don't accumulate variants.
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`))
      .map((e) => fs.unlink(path.join(dir, e)).catch(() => null)),
  );

  const ext = mimeToExt(mime);
  const filename = `${MANNEQUIN_SOURCE_PREFIX}.${ext}`;
  const fullPath = path.join(dir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return fullPath;
}

export async function saveRendered(userId: string, png: Buffer): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, MANNEQUIN_FILENAME);
  await fs.writeFile(fullPath, png);
}

function mimeToExt(mime: string): string {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  return "jpg";
}
