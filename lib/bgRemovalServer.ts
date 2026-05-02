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

// The package's ImageSource union includes Uint8Array, and Node's
// Buffer extends Uint8Array, so we can pass the file Buffer straight
// through — no need for the Blob wrap that the previous version did.
// Skipping the wrap removes one layer that could fail silently in
// older Node Blob implementations.
type RemoveBackgroundFn = (input: Buffer) => Promise<Blob>;

let removerPromise: Promise<RemoveBackgroundFn> | null = null;

async function getRemover(): Promise<RemoveBackgroundFn> {
  if (!removerPromise) {
    removerPromise = (async () => {
      const mod = await import("@imgly/background-removal-node");
      const fn = mod.removeBackground as (input: Buffer, config?: unknown) => Promise<Blob>;
      if (typeof fn !== "function") {
        throw new Error("background-removal-node missing removeBackground()");
      }
      return ((input: Buffer) =>
        fn(input, { model: "small", output: { format: "image/png" } })) as RemoveBackgroundFn;
    })().catch((err) => {
      // Drop the cache so a future call gets a fresh shot. Without
      // this, a transient model-download failure would persist for
      // the whole process lifetime.
      removerPromise = null;
      console.error("background-removal-node failed to load:", err);
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return removerPromise;
}

// Read the file the bulk upload saved earlier, run bg removal, write
// the result alongside it, and return the new relative path.
async function processOne(
  remove: RemoveBackgroundFn,
  userId: string,
  itemId: string,
  sourceRelPath: string,
): Promise<string> {
  const sourceAbs = path.join(UPLOAD_ROOT, sourceRelPath);
  const buf = await fs.readFile(sourceAbs);
  const out = await remove(buf);
  const outBuf = Buffer.from(await out.arrayBuffer());
  // Random suffix on every run so the existing /api/uploads/
  // immutable cache headers don't pin stale art if the user
  // regenerates.
  const tag = Math.random().toString(36).slice(2, 8);
  return saveBuffer(userId, itemId, outBuf, `bg-${tag}`, "png");
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
