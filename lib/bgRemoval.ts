"use client";

// Loads @imgly/background-removal from the locally-served bundle in
// public/vendor/imgly/. The model + WASM assets live next to it (fetched
// once by `npm run fetch-vendor`). No CDN calls at runtime once the vendor
// directory is populated.
//
// Two production-relevant details:
// 1. The ONNX session isn't safely reentrant under concurrent calls, so
//    multiple uploads (bulk) used to fail silently. We serialize
//    calls through a single in-flight promise queue.
// 2. If the module load fails (network blip, stale build), we want
//    retry to succeed — so on error we drop the cached promise.

const LIB_URL = "/vendor/imgly/index.mjs";
const PUBLIC_PATH = "/vendor/imgly/";

type RemoveBackground = (
  input: Blob,
  config?: { publicPath?: string; debug?: boolean },
) => Promise<Blob>;

let _removerPromise: Promise<RemoveBackground> | null = null;

async function getRemover(): Promise<RemoveBackground> {
  if (!_removerPromise) {
    _removerPromise = (async () => {
      try {
        const mod = (await import(/* webpackIgnore: true */ LIB_URL)) as {
          removeBackground?: RemoveBackground;
        };
        const fn = mod.removeBackground;
        if (typeof fn !== "function") {
          throw new Error("background-removal module missing removeBackground()");
        }
        return fn;
      } catch (err) {
        // Don't poison the cache — let the next call try again.
        _removerPromise = null;
        throw err;
      }
    })();
  }
  return _removerPromise;
}

// Single in-flight chain so concurrent removeBackground() calls don't
// race the ONNX session. Each new call waits for the previous to finish.
let _queue: Promise<unknown> = Promise.resolve();

export function removeBackground(input: Blob): Promise<Blob> {
  const next = _queue.then(async () => {
    const remove = await getRemover();
    return remove(input, { publicPath: PUBLIC_PATH });
  });
  // Keep the chain alive even if one job throws.
  _queue = next.catch(() => {});
  return next as Promise<Blob>;
}

// Force the next call to reload the module (used by the "Try again"
// button when the model load failed).
export function resetBackgroundRemover() {
  _removerPromise = null;
}
