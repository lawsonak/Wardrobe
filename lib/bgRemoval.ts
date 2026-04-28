"use client";

// Loads @imgly/background-removal from the locally-served bundle in
// public/vendor/imgly/, then chooses where to load the model + WASM
// assets from:
//
//   1. /vendor/imgly/  (set by `npm run fetch-vendor` if the fetch
//      reached staticimgly.com during install)
//   2. https://staticimgly.com/@imgly/background-removal-data/<v>/dist/
//      (public CDN — used as a fallback if the local resources.json
//      is missing or the local load throws)
//
// The probe happens once per page load. The browser caches the model
// after the first removal, so subsequent calls are fast either way.

const LIB_URL = "/vendor/imgly/index.mjs";
const LOCAL_PUBLIC_PATH = "/vendor/imgly/";
// imgly publishes one data bundle per minor version. We pin to the
// version of the JS bundle we ship — keep this in sync with the imgly
// dep in package.json.
const IMGLY_DATA_VERSION = "1.7.0";
const CDN_PUBLIC_PATH = `https://staticimgly.com/@imgly/background-removal-data/${IMGLY_DATA_VERSION}/dist/`;

type RemoveBackground = (
  input: Blob,
  config?: { publicPath?: string; debug?: boolean },
) => Promise<Blob>;

let _removerPromise: Promise<RemoveBackground> | null = null;
let _publicPath: string | null = null;

async function pickPublicPath(): Promise<string> {
  if (_publicPath) return _publicPath;
  try {
    const res = await fetch(`${LOCAL_PUBLIC_PATH}resources.json`, { cache: "no-store" });
    if (res.ok) {
      _publicPath = LOCAL_PUBLIC_PATH;
      return _publicPath;
    }
  } catch {
    /* fall through */
  }
  _publicPath = CDN_PUBLIC_PATH;
  return _publicPath;
}

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

export async function removeBackground(input: Blob): Promise<Blob> {
  const next = _queue.then(async () => {
    const remove = await getRemover();
    const publicPath = await pickPublicPath();
    try {
      return await remove(input, { publicPath });
    } catch (err) {
      // If we were on local and it bombed mid-removal (model file
      // missing, etc.), retry once on the CDN so the user gets a
      // result instead of a hard fail.
      if (publicPath === LOCAL_PUBLIC_PATH) {
        console.warn("Local bg removal failed, retrying via CDN:", err);
        _publicPath = CDN_PUBLIC_PATH;
        return await remove(input, { publicPath: CDN_PUBLIC_PATH });
      }
      throw err;
    }
  });
  _queue = next.catch(() => {});
  return next as Promise<Blob>;
}

// Force the next call to reload the module + reprobe publicPath.
export function resetBackgroundRemover() {
  _removerPromise = null;
  _publicPath = null;
}

// Read-only: where the next call will fetch model assets from. Useful
// for diagnostics.
export function currentPublicPath(): string | null {
  return _publicPath;
}
