import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

// iPhone photos are routinely 3–4 MB at 4032×3024. The closet grid
// shows hundreds of these as small thumbnails — serving the originals
// over LAN is the single biggest performance hit. Resize to a max edge
// of 1600 px (more than enough for the item-detail hero on a 4K
// monitor) and re-encode at quality 85; that brings a typical photo
// from 3 MB to ~250 KB without visible quality loss.
const MAX_EDGE_PX = 1600;
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
