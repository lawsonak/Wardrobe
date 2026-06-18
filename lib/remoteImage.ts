// Download a remote image (a product page's og:image / JSON-LD image)
// and save it to the per-user uploads tree the same way the rest of the
// app stores photos: EXIF orientation baked in and resized down via
// sharp so a 4 MB CDN original doesn't land at full size.
//
// Used by the collection shopping-list importer, which pulls a product
// thumbnail from a pasted link. The image is always optional — any
// failure (blocked host, non-image content-type, sharp can't decode,
// network blip) returns null and the caller renders the card without a
// thumbnail.
//
// SSRF guard mirrors lib/productMeta.ts: refuse loopback / private-ish
// hosts so a malicious og:image URL can't aim the server at its own
// internal services. Belt-and-suspenders for a two-user personal app.

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DISPLAY_MAX_EDGE_PX = 1024;

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isPrivateHost(host: string): boolean {
  return (
    PRIVATE_HOSTS.has(host) ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("169.254.") ||
    // 172.16.0.0 – 172.31.255.255
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Fetch `imageUrl`, resize/normalize via sharp, and write it under
 * `<userId>/<subdir>/<basename>.<ext>`. Returns the relative POSIX path
 * (what the rest of the app stores in `imagePath` columns) or null on
 * any failure — the image is treated as optional everywhere this is used.
 */
export async function saveRemoteImage(args: {
  userId: string;
  subdir: string;
  basename: string;
  imageUrl: string;
}): Promise<string | null> {
  const { userId, subdir, basename, imageUrl } = args;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (isPrivateHost(parsed.hostname.toLowerCase())) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(imageUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);

  if (!res.ok) return null;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct && !ct.startsWith("image/")) return null;

  // Bounded read so a hostile huge "image" can't OOM the process.
  let raw: Buffer;
  try {
    raw = await readBounded(res, MAX_IMAGE_BYTES);
  } catch {
    return null;
  }
  if (raw.byteLength === 0) return null;

  let outBuf: Buffer = raw;
  let outExt = "jpg";
  try {
    const pipeline = sharp(raw, { failOn: "none" })
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE_PX,
        height: DISPLAY_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
    const meta = await sharp(raw, { failOn: "none" }).metadata();
    if (meta.format === "png") {
      outBuf = await pipeline.png({ compressionLevel: 9, effort: 6 }).toBuffer();
      outExt = "png";
    } else if (meta.format === "webp") {
      outBuf = await pipeline.webp({ quality: 85 }).toBuffer();
      outExt = "webp";
    } else {
      outBuf = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      outExt = "jpg";
    }
  } catch {
    // sharp couldn't decode it — bail rather than store an unknown blob.
    return null;
  }

  const userDir = path.join(UPLOAD_ROOT, userId, subdir);
  try {
    await fs.mkdir(userDir, { recursive: true });
    const filename = `${basename}.${outExt}`;
    await fs.writeFile(path.join(userDir, filename), outBuf);
    return path.posix.join(userId, subdir, filename);
  } catch {
    return null;
  }
}

async function readBounded(res: Response, max: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < max) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
  }
  if (total >= max) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks);
}
