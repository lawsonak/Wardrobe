// Server-only helpers for the per-user "custom mannequin" feature.
// We store the AI-rendered illustration on disk under the user's
// upload directory and serve it via the existing /api/uploads route.
//
// Files per user:
//   data/uploads/{userId}/mannequin.png             — rendered illustration
//   data/uploads/{userId}/mannequin-source.<ext>    — original photo (kept
//       so "Regenerate" can re-run without re-uploading)
//   data/uploads/{userId}/mannequin-landmarks.json  — anatomical anchor
//       points used to fit clothing items to this specific mannequin

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Landmarks } from "@/lib/ai/mannequinLandmarks";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
export const MANNEQUIN_FILENAME = "mannequin.png";
export const MANNEQUIN_SOURCE_PREFIX = "mannequin-source";
export const MANNEQUIN_LANDMARKS_FILENAME = "mannequin-landmarks.json";

export type MannequinInfo = {
  /** Path served via /api/uploads/<rel> when present, else null. */
  url: string | null;
  hasSource: boolean;
  /** Disk path to the rendered PNG when present (server-only). */
  renderedAbsPath: string | null;
  /** Cached anatomical landmarks for the rendered mannequin, when known. */
  landmarks: Landmarks | null;
};

export async function getMannequinForUser(userId: string): Promise<MannequinInfo> {
  if (!userId) return { url: null, hasSource: false, renderedAbsPath: null, landmarks: null };
  const dir = path.join(UPLOAD_ROOT, userId);
  const renderedAbs = path.join(dir, MANNEQUIN_FILENAME);
  let url: string | null = null;
  let renderedAbsPath: string | null = null;
  try {
    await fs.access(renderedAbs);
    const stat = await fs.stat(renderedAbs);
    url = `/api/uploads/${userId}/${MANNEQUIN_FILENAME}?v=${stat.mtimeMs.toFixed(0)}`;
    renderedAbsPath = renderedAbs;
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

  const landmarks = await readLandmarks(userId);
  return { url, hasSource, renderedAbsPath, landmarks };
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
        .filter(
          (e) =>
            e === MANNEQUIN_FILENAME ||
            e === MANNEQUIN_LANDMARKS_FILENAME ||
            e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`),
        )
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

export async function readRenderedPng(userId: string): Promise<Buffer | null> {
  const dir = path.join(UPLOAD_ROOT, userId);
  const fullPath = path.join(dir, MANNEQUIN_FILENAME);
  try {
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
}

export async function saveLandmarks(userId: string, landmarks: Landmarks): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, MANNEQUIN_LANDMARKS_FILENAME),
    JSON.stringify(landmarks, null, 2),
  );
}

export async function readLandmarks(userId: string): Promise<Landmarks | null> {
  if (!userId) return null;
  const dir = path.join(UPLOAD_ROOT, userId);
  try {
    const raw = await fs.readFile(path.join(dir, MANNEQUIN_LANDMARKS_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as Landmarks;
    return parsed;
  } catch {
    return null;
  }
}

function mimeToExt(mime: string): string {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  return "jpg";
}
