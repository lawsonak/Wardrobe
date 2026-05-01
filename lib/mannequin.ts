// Per-user "personal mannequin" storage. The user uploads a photo of
// themselves; Gemini generates a stylized fashion-illustration mannequin
// from it; that illustration is saved here and used as the base image
// when the AI try-on composites their outfits.
//
// Files per user (under data/uploads/<userId>/):
//   mannequin.png             — generated illustration (the actual
//                                reference fed to the try-on model)
//   mannequin-source.<ext>    — original uploaded photo, kept so
//                                "Regenerate" can re-run without
//                                re-uploading
//   mannequin-head.png        — optional: stylized head crop (matching
//                                the mannequin's illustration style)
//                                that the try-on UI overlays on top
//                                of the AI-rendered body via CSS, no
//                                AI in the merge step. Easy to remove
//                                from Settings to back out of the
//                                feature without losing the mannequin.
//   mannequin.json            — metadata: { id, createdAt, headBBox? }.
//                                The `id` is included in try-on cache
//                                hashes so regenerating invalidates
//                                the cache. headBBox positions the
//                                head overlay (normalized 0..1).

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const MANNEQUIN_FILENAME = "mannequin.png";
const MANNEQUIN_HEAD_FILENAME = "mannequin-head.png";
const MANNEQUIN_SOURCE_PREFIX = "mannequin-source";
const MANNEQUIN_META_FILENAME = "mannequin.json";

// Frame coordinates for where the head sits on a freshly generated
// mannequin (head fully visible at the top per the prompt). Used as a
// fallback when no per-mannequin bbox has been computed. Normalized
// 0..1 of the rendered image — width × 9:16 → these % values stay
// stable across screen sizes.
const DEFAULT_HEAD_BBOX = { x: 0.34, y: 0.015, w: 0.32, h: 0.18 };

export type HeadBBox = { x: number; y: number; w: number; h: number };

export type UserMannequinInfo = {
  /** Path served via /api/uploads/<rel> when present, else null. */
  url: string | null;
  hasSource: boolean;
  /** Stable id used in try-on cache hashes. Null when no mannequin. */
  id: string | null;
  /** Stylized head overlay served via /api/uploads/, when present. */
  headUrl: string | null;
  /** Where the head should sit on the mannequin image (0..1). Always
   *  set when headUrl is set, falling back to DEFAULT_HEAD_BBOX. */
  headBBox: HeadBBox | null;
};

type Meta = { id: string; createdAt: string; headBBox?: HeadBBox };

function userDir(userId: string): string {
  return path.join(UPLOAD_ROOT, userId);
}

export async function getUserMannequin(userId: string): Promise<UserMannequinInfo> {
  if (!userId) return { url: null, hasSource: false, id: null, headUrl: null, headBBox: null };
  const dir = userDir(userId);
  const renderedAbs = path.join(dir, MANNEQUIN_FILENAME);
  let url: string | null = null;
  try {
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

  let headUrl: string | null = null;
  const headAbs = path.join(dir, MANNEQUIN_HEAD_FILENAME);
  try {
    const stat = await fs.stat(headAbs);
    headUrl = `/api/uploads/${userId}/${MANNEQUIN_HEAD_FILENAME}?v=${stat.mtimeMs.toFixed(0)}`;
  } catch {
    /* not present */
  }

  const meta = await readMeta(userId);
  const headBBox = headUrl ? meta?.headBBox ?? DEFAULT_HEAD_BBOX : null;

  return {
    url,
    hasSource,
    id: meta?.id ?? null,
    headUrl,
    headBBox,
  };
}

export async function readUserMannequinPng(
  userId: string,
): Promise<{ buf: Buffer; id: string } | null> {
  if (!userId) return null;
  const dir = userDir(userId);
  try {
    const buf = await fs.readFile(path.join(dir, MANNEQUIN_FILENAME));
    const meta = await readMeta(userId);
    const id = meta?.id ?? `user-${userId}-fallback`;
    return { buf, id };
  } catch {
    return null;
  }
}

export async function findSourcePath(userId: string): Promise<string | null> {
  if (!userId) return null;
  const dir = userDir(userId);
  try {
    const entries = await fs.readdir(dir);
    const match = entries.find((e) => e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export async function saveSourcePhoto(
  userId: string,
  file: Blob,
  mime: string,
): Promise<string> {
  const dir = userDir(userId);
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

export async function readSourcePhoto(
  userId: string,
): Promise<{ buf: Buffer; mime: string } | null> {
  const sourcePath = await findSourcePath(userId);
  if (!sourcePath) return null;
  const buf = await fs.readFile(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase();
  const mime = extToMime(ext);
  return { buf, mime };
}

export async function saveRendered(userId: string, png: Buffer): Promise<UserMannequinInfo> {
  const dir = userDir(userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, MANNEQUIN_FILENAME), png);
  // Bump the id on every generation so try-on caches invalidate.
  const meta: Meta = {
    id: `user-${userId.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, MANNEQUIN_META_FILENAME), JSON.stringify(meta, null, 2));
  return getUserMannequin(userId);
}

export async function clearUserMannequin(userId: string): Promise<void> {
  if (!userId) return;
  const dir = userDir(userId);
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter(
          (e) =>
            e === MANNEQUIN_FILENAME ||
            e === MANNEQUIN_HEAD_FILENAME ||
            e === MANNEQUIN_META_FILENAME ||
            e.startsWith(`${MANNEQUIN_SOURCE_PREFIX}.`),
        )
        .map((e) => fs.unlink(path.join(dir, e)).catch(() => null)),
    );
  } catch {
    /* nothing to clear */
  }
}

export async function saveStylizedHead(userId: string, png: Buffer): Promise<void> {
  const dir = userDir(userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, MANNEQUIN_HEAD_FILENAME), png);
  // Default bbox is good enough until/unless we add per-mannequin
  // detection. Mannequin id stays the same — the head overlay isn't
  // baked into the try-on PNG, it's CSS-stacked, so cached try-ons
  // don't need to invalidate.
  const meta = (await readMeta(userId)) ?? { id: `user-${userId.slice(0, 8)}`, createdAt: new Date().toISOString() };
  if (!meta.headBBox) meta.headBBox = DEFAULT_HEAD_BBOX;
  await fs.writeFile(path.join(dir, MANNEQUIN_META_FILENAME), JSON.stringify(meta, null, 2));
}

export async function clearStylizedHead(userId: string): Promise<void> {
  if (!userId) return;
  const dir = userDir(userId);
  try {
    await fs.unlink(path.join(dir, MANNEQUIN_HEAD_FILENAME));
  } catch {
    /* not present */
  }
  const meta = await readMeta(userId);
  if (meta?.headBBox) {
    delete meta.headBBox;
    await fs.writeFile(path.join(dir, MANNEQUIN_META_FILENAME), JSON.stringify(meta, null, 2));
  }
}

async function readMeta(userId: string): Promise<Meta | null> {
  const dir = userDir(userId);
  try {
    const raw = await fs.readFile(path.join(dir, MANNEQUIN_META_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as Partial<Meta>;
    if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "string") return null;
    return { id: parsed.id, createdAt: parsed.createdAt };
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

function extToMime(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "image/jpeg";
}
