// Server-side background removal via @imgly/background-removal-node.
// Used by the bulk upload route to free the user's tab — the client
// flow in lib/bgRemoval.ts (browser WebGPU/WASM) stays in place for
// single-photo edits where the user is already on the page.
//
// Same ONNX model as the browser flow (small u2net), but onnxruntime-
// node runs CPU-only so per-photo time is in the ~5-10s range on
// modest hardware. We cap concurrency to limit how much the bulk
// import can starve the rest of the app — with 6 CPU cores, 3 in
// flight at once is the sweet spot before workers start fighting for
// cores.
//
// The model + assets get downloaded from a public CDN on first call
// and cached to disk under node_modules; subsequent calls are warm.
// Loading the model the first time takes 2-5s, so we lazy-init and
// keep the resolved removal function in module scope.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { UPLOAD_ROOT, saveBuffer, unlinkUpload } from "@/lib/uploads";

const MAX_CONCURRENT = 3;

// The package's ImageSource union includes ArrayBuffer / Uint8Array,
// but its internal `imageSourceToImageData` wraps non-Blob inputs in a
// fresh `new Blob([buf])` — *without* a MIME type — and then
// `imageDecode` reads `blob.type` to pick a codec. Empty string falls
// through to "Unsupported format: ". So we have to construct the Blob
// ourselves with the right type from the file extension before
// handing it off.
//
// Map of file extensions to MIME types the package's switch handles:
// PNG, JPEG, WebP. (Old HEIC files get a clear "unsupported HEIC"
// error rather than silent failure.)
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

type RemoveBackgroundFn = (input: Blob) => Promise<Blob>;

let removerPromise: Promise<RemoveBackgroundFn> | null = null;
let hiResRemoverPromise: Promise<RemoveBackgroundFn> | null = null;

async function loadRemover(model: "small" | "medium"): Promise<RemoveBackgroundFn> {
  const mod = await import("@imgly/background-removal-node");
  const fn = mod.removeBackground as (input: Blob, config?: unknown) => Promise<Blob>;
  if (typeof fn !== "function") {
    throw new Error("background-removal-node missing removeBackground()");
  }
  return (input: Blob) =>
    fn(input, { model, output: { format: "image/png" } });
}

async function getRemover(): Promise<RemoveBackgroundFn> {
  if (!removerPromise) {
    removerPromise = loadRemover("small").catch((err) => {
      // Drop the cache so a future call gets a fresh shot. Without
      // this, a transient model-download failure would persist for
      // the whole process lifetime.
      removerPromise = null;
      console.error("background-removal-node (small) failed to load:", err);
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return removerPromise;
}

// Hi-res path uses the "medium" model for cleaner edges at full
// resolution. The lightbox shows every halo and chopped pixel that
// the smaller model glosses over, so the extra inference cost
// (~2-3× the small model) is worth it here. Cached on its own so
// the existing display-tier flow keeps using the fast model.
async function getHiResRemover(): Promise<RemoveBackgroundFn> {
  if (!hiResRemoverPromise) {
    hiResRemoverPromise = loadRemover("medium").catch((err) => {
      hiResRemoverPromise = null;
      console.error("background-removal-node (medium) failed to load:", err);
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return hiResRemoverPromise;
}

// Read the file from disk, wrap in a typed Blob so the package can
// detect the format, run bg removal, save the result, return the new
// relative path. `filenamePrefix` distinguishes display ("bg") from
// hi-res ("bg-hires") cutouts so they live side-by-side without
// stomping each other.
async function processOne(
  remove: RemoveBackgroundFn,
  userId: string,
  itemId: string,
  sourceRelPath: string,
  filenamePrefix: string = "bg",
): Promise<string> {
  const sourceAbs = path.join(UPLOAD_ROOT, sourceRelPath);
  const ext = path.extname(sourceRelPath).toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    // .heic, .gif, .tiff, .avif, etc. The model package's codecs only
    // handle PNG/JPEG/WebP. Bail with a clear, actionable message
    // instead of forwarding to the package and getting "Unsupported
    // format: " back. Item still has its original photo; user can
    // re-upload as JPEG.
    throw new Error(`Unsupported file type "${ext || "(none)"}" — only JPEG/PNG/WebP can run server-side bg removal`);
  }
  const buf = await fs.readFile(sourceAbs);
  // Construct the Blob with the explicit MIME type. Without this the
  // package wraps the bytes in a typeless Blob and bails with
  // "Unsupported format: " (its codec switch reads blob.type).
  const blob = new Blob([buf], { type: mime });
  const out = await remove(blob);
  const outBuf = Buffer.from(await out.arrayBuffer());
  const tag = Math.random().toString(36).slice(2, 8);
  return saveBuffer(userId, itemId, outBuf, `${filenamePrefix}-${tag}`, "png");
}

// Public entry point: process a list of items in parallel up to
// MAX_CONCURRENT. Each item that succeeds gets its imageBgRemovedPath
// updated in the DB. Failures are captured per-item; the caller decides
// what to do with them (typically log + drop a notification).
//
// `prisma` is passed in so this module doesn't ship a hard
// dependency on @/lib/db (which would pull a server-only client into
// any caller — keeping the surface narrow makes future swaps easier).
export type BgRemovalItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
};

export type BgRemovalResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

// Hi-res batch: parallel to runBgRemovalBatch but reads imageOriginalPath
// (full-res), runs through the bigger "medium" model, and writes to
// imageBgRemovedOriginalPath. The lightbox tap-to-zoom prefers this
// when present so the user sees a real cutout at zoom-quality.
//
// Items missing imageOriginalPath fall back to imagePath (legacy
// uploads pre two-tier-storage). Items missing both are skipped with
// a clear error so the per-item failure is diagnosable.
export async function runHiResBgRemovalBatch(
  prisma: PrismaClient,
  userId: string,
  itemIds: string[],
): Promise<BgRemovalResult> {
  if (itemIds.length === 0) return { succeeded: [], failed: [] };

  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, ownerId: userId },
    select: {
      id: true,
      imagePath: true,
      imageOriginalPath: true,
      imageBgRemovedOriginalPath: true,
    },
  });

  let remove: RemoveBackgroundFn;
  try {
    remove = await getHiResRemover();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("hi-res bg removal: model load failed:", message);
    return {
      succeeded: [],
      failed: items.map((it) => ({ id: it.id, error: `model load failed: ${message.slice(0, 160)}` })),
    };
  }

  const result: BgRemovalResult = { succeeded: [], failed: [] };
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const it = items[i];
      const source = it.imageOriginalPath ?? it.imagePath;
      if (!source) {
        result.failed.push({ id: it.id, error: "No source photo on item" });
        continue;
      }
      try {
        const newPath = await processOne(remove, userId, it.id, source, "bg-hires");
        if (
          it.imageBgRemovedOriginalPath &&
          it.imageBgRemovedOriginalPath !== newPath
        ) {
          await unlinkUpload(it.imageBgRemovedOriginalPath);
        }
        await prisma.item.update({
          where: { id: it.id },
          data: { imageBgRemovedOriginalPath: newPath },
        });
        result.succeeded.push(it.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (result.failed.length === 0 && err instanceof Error) {
          console.error(`hi-res bg removal failed for item ${it.id}:`, err);
        } else {
          console.warn(`hi-res bg removal failed for item ${it.id}:`, message);
        }
        result.failed.push({ id: it.id, error: message.slice(0, 200) });
      }
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, worker);
  await Promise.all(workers);
  return result;
}

export async function runBgRemovalBatch(
  prisma: PrismaClient,
  userId: string,
  itemIds: string[],
): Promise<BgRemovalResult> {
  if (itemIds.length === 0) return { succeeded: [], failed: [] };

  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, ownerId: userId },
    select: { id: true, imagePath: true, imageBgRemovedPath: true },
  });

  // Resolve the model up front. If the dynamic import or the model
  // assets fail to load, every item would otherwise come back with the
  // same per-item error and the user would see a generic "0 of N
  // succeeded" notification with no top-level diagnostic. Failing here
  // bubbles a single, clear "model failed to load" error to the
  // notification body.
  let remove: RemoveBackgroundFn;
  try {
    remove = await getRemover();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("bg removal: model load failed, marking entire batch:", message);
    return {
      succeeded: [],
      failed: items.map((it) => ({ id: it.id, error: `model load failed: ${message.slice(0, 160)}` })),
    };
  }

  const result: BgRemovalResult = { succeeded: [], failed: [] };
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const it = items[i];
      try {
        const newBgPath = await processOne(remove, userId, it.id, it.imagePath);
        // If the item already had a bg cutout, unlink the old one so we
        // don't accumulate orphans. Best-effort.
        if (it.imageBgRemovedPath && it.imageBgRemovedPath !== newBgPath) {
          await unlinkUpload(it.imageBgRemovedPath);
        }
        await prisma.item.update({
          where: { id: it.id },
          data: { imageBgRemovedPath: newBgPath },
        });
        result.succeeded.push(it.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // First failure gets the full stack so we can diagnose; the
        // rest just log the message to keep stdout sane.
        if (result.failed.length === 0 && err instanceof Error) {
          console.error(`bg removal failed for item ${it.id}:`, err);
        } else {
          console.warn(`bg removal failed for item ${it.id}:`, message);
        }
        result.failed.push({ id: it.id, error: message.slice(0, 200) });
      }
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, worker);
  await Promise.all(workers);
  return result;
}

// Same shape as runBgRemovalBatch but for ItemPhoto rows (extra
// angle photos and label / care-tag close-ups). The display-tier
// cutout lives at ItemPhoto.imageBgRemovedPath; the filename suffix
// distinguishes labels (`label-bg`) from extra angles (`angle-bg`)
// so the user's data dir stays browsable.
//
// Used by the Settings → Optimize Photos pass to backfill cutouts
// on label / angle photos that were uploaded before the per-photo
// bg-removal pipeline shipped (and therefore have null
// imageBgRemovedPath even though there's a perfectly good source
// image to cut out).
export async function runItemPhotoBgRemovalBatch(
  prisma: PrismaClient,
  userId: string,
  photoIds: string[],
): Promise<BgRemovalResult> {
  if (photoIds.length === 0) return { succeeded: [], failed: [] };

  const photos = await prisma.itemPhoto.findMany({
    where: { id: { in: photoIds }, item: { ownerId: userId } },
    select: {
      id: true,
      kind: true,
      imagePath: true,
      imageBgRemovedPath: true,
    },
  });

  let remove: RemoveBackgroundFn;
  try {
    remove = await getRemover();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("bg removal (ItemPhoto): model load failed:", message);
    return {
      succeeded: [],
      failed: photos.map((p) => ({ id: p.id, error: `model load failed: ${message.slice(0, 160)}` })),
    };
  }

  const result: BgRemovalResult = { succeeded: [], failed: [] };
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= photos.length) return;
      const p = photos[i];
      try {
        const prefix = p.kind === "label" ? "label-bg" : "angle-bg";
        const newBgPath = await processOne(remove, userId, p.id, p.imagePath, prefix);
        if (p.imageBgRemovedPath && p.imageBgRemovedPath !== newBgPath) {
          await unlinkUpload(p.imageBgRemovedPath);
        }
        await prisma.itemPhoto.update({
          where: { id: p.id },
          data: { imageBgRemovedPath: newBgPath },
        });
        result.succeeded.push(p.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (result.failed.length === 0 && err instanceof Error) {
          console.error(`bg removal failed for photo ${p.id} (${p.kind}):`, err);
        } else {
          console.warn(`bg removal failed for photo ${p.id} (${p.kind}):`, message);
        }
        result.failed.push({ id: p.id, error: message.slice(0, 200) });
      }
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, photos.length) }, worker);
  await Promise.all(workers);
  return result;
}
