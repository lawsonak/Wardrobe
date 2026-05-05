import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

// iPhone photos are routinely 3–4 MB at 4032×3024. Two-tier storage:
// `MAX_EDGE_PX` is the display variant served everywhere (closet grid,
// outfit cards, item-detail hero, AI try-on) — small + fast over LAN.
// The full-resolution upload is preserved untouched alongside it via
// `saveUploadWithOriginal`, so the item-detail page's tap-to-zoom
// shows real detail (embroidery, stitching, fabric weave) instead of
// pixel mush. JPEG q85 is a near-imperceptible quality loss against
// the source, with ~10× the throughput of the raw file.
const MAX_EDGE_PX = 1024;
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 85;

const KNOWN_EXTS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function safeExtFromMime(mime: string | undefined, fallback: string): string {
  if (mime && KNOWN_EXTS[mime]) return KNOWN_EXTS[mime];
  const raw = (mime?.split("/")[1] || fallback).replace(/[^a-z0-9]/gi, "");
  return raw || fallback;
}

/**
 * Resize + re-encode an uploaded image to keep the on-disk footprint
 * sane. Returns the processed buffer plus the canonical extension to
 * use when writing it to disk.
 *
 * Behaviour:
 *  - Reads EXIF orientation (`.rotate()` with no args) so phone photos
 *    end up the right way up on disk; downstream readers don't need
 *    EXIF awareness anymore.
 *  - Shrinks the longer edge to MAX_EDGE_PX. `withoutEnlargement: true`
 *    leaves smaller images untouched.
 *  - Re-encodes JPEG → JPEG q85, PNG → PNG (alpha preserved), WebP →
 *    WebP q85. GIFs are passed through (sharp loses animation).
 *  - On any failure (corrupt header, unsupported codec, sharp not
 *    available at runtime), falls back to the raw buffer + the
 *    caller-provided ext so uploads always succeed.
 */
async function compressImage(
  buf: Buffer,
  mime: string,
  fallbackExt: string,
): Promise<{ buf: Buffer; ext: string }> {
  // Sniff codecs we don't want to round-trip (svg, heic, octet-stream).
  const ext = KNOWN_EXTS[mime] ?? "";
  if (!ext || ext === "gif") {
    return { buf, ext: ext || fallbackExt };
  }
  try {
    const pipeline = sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true });

    if (ext === "png") {
      // PNG keeps alpha; effort 6 is sharp's default and a good speed/
      // size balance — not worth the extra CPU for higher.
      const out = await pipeline.png({ compressionLevel: 9, effort: 6 }).toBuffer();
      return { buf: out, ext: "png" };
    }
    if (ext === "webp") {
      const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
      return { buf: out, ext: "webp" };
    }
    // jpg / jpeg
    const out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return { buf: out, ext: "jpg" };
  } catch {
    return { buf, ext: ext || fallbackExt };
  }
}

export async function saveUpload(
  userId: string,
  idPrefix: string,
  file: File,
  suffix: string,
  options?: { bust?: boolean; resize?: boolean },
): Promise<string> {
  const userDir = path.join(UPLOAD_ROOT, userId);
  // 0o700 keeps these files readable only by the app user; defense in
  // depth on a multi-tenant LXC host.
  await fs.mkdir(userDir, { recursive: true, mode: 0o700 });

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const fallbackExt = safeExtFromMime(file.type, "png");

  // Always compress unless explicitly disabled. Saved buffers from AI
  // pipelines have their own helper (`saveBuffer`) and bypass this.
  const { buf, ext } =
    options?.resize === false
      ? { buf: rawBuf, ext: fallbackExt }
      : await compressImage(rawBuf, file.type, fallbackExt);

  const tag = options?.bust ? `-${Math.random().toString(36).slice(2, 8)}` : "";
  const filename = `${idPrefix}-${suffix}${tag}.${ext}`;
  const fullPath = path.join(userDir, filename);
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

/**
 * Two-tier write for user-precious photos: persist the original
 * untouched and a small display variant alongside it. Returns both
 * paths for the caller to store on the row.
 *
 * The display variant is always ~1024 px max edge / q85 — small and
 * fast for grids, cards, and the AI try-on input. The original keeps
 * full resolution for the item-detail tap-to-zoom; we still pipe it
 * through `sharp().rotate()` so EXIF rotation is baked in (otherwise
 * iPhone landscape shots come out sideways on browsers that ignore
 * EXIF in zoomed views).
 *
 * GIFs and unsupported codecs fall back to a single raw write — sharp
 * would lose animation and we don't have a reasonable display variant.
 */
export async function saveUploadWithOriginal(
  userId: string,
  idPrefix: string,
  file: File,
  suffix: string,
  options?: { bust?: boolean },
): Promise<{ displayPath: string; originalPath: string | null }> {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true, mode: 0o700 });

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const fallbackExt = safeExtFromMime(file.type, "png");
  const tag = options?.bust ? `-${Math.random().toString(36).slice(2, 8)}` : "";

  // GIF / unsupported types: keep the single-write path. The raw file
  // is the display variant; no separate original (storing the same
  // bytes twice would waste disk).
  const knownExt = KNOWN_EXTS[file.type] ?? "";
  if (!knownExt || knownExt === "gif") {
    const filename = `${idPrefix}-${suffix}${tag}.${fallbackExt}`;
    await fs.writeFile(path.join(userDir, filename), rawBuf);
    return { displayPath: path.posix.join(userId, filename), originalPath: null };
  }

  // Original: EXIF-rotated, otherwise untouched. Re-encoding with
  // sharp at the same format + quality 100 (jpeg) / lossless (webp) /
  // max compression (png) gets us the rotation without measurable
  // quality loss.
  let originalBuf: Buffer = rawBuf;
  let originalExt = knownExt;
  try {
    const orig = sharp(rawBuf, { failOn: "none" }).rotate();
    if (knownExt === "png") {
      originalBuf = await orig.png({ compressionLevel: 9 }).toBuffer();
    } else if (knownExt === "webp") {
      originalBuf = await orig.webp({ lossless: true }).toBuffer();
    } else {
      originalBuf = await orig.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      originalExt = "jpg";
    }
  } catch {
    // Sharp failed — fall back to the raw bytes. Lightbox might show
    // the wrong orientation on EXIF-rotated images but the photo is
    // still there.
    originalBuf = rawBuf;
    originalExt = fallbackExt;
  }

  const { buf: displayBuf, ext: displayExt } = await compressImage(
    rawBuf,
    file.type,
    fallbackExt,
  );

  const displayName = `${idPrefix}-${suffix}${tag}.${displayExt}`;
  const originalName = `${idPrefix}-${suffix}${tag}-orig.${originalExt}`;

  await Promise.all([
    fs.writeFile(path.join(userDir, displayName), displayBuf),
    fs.writeFile(path.join(userDir, originalName), originalBuf),
  ]);

  return {
    displayPath: path.posix.join(userId, displayName),
    originalPath: path.posix.join(userId, originalName),
  };
}

export async function saveBuffer(
  userId: string,
  idPrefix: string,
  buf: Buffer,
  suffix: string,
  ext: string,
): Promise<string> {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true, mode: 0o700 });
  const safeExt = ext.replace(/[^a-z0-9]/gi, "") || "png";
  const filename = `${idPrefix}-${suffix}.${safeExt}`;
  const fullPath = path.join(userDir, filename);
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

export async function unlinkUpload(relPath: string | null | undefined): Promise<void> {
  if (!relPath) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, relPath));
  } catch {
    /* ignore */
  }
}
