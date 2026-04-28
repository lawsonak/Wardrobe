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
// Speed knobs:
//   - Inputs are downscaled to a max edge of MAX_INPUT_DIM (default 1280)
//     before the model runs. iPhone photos are typically 4032x3024, which
//     is 9-12x more pixels than the model needs for a clothing card.
//   - We pass `model: 'small'` for a smaller/faster network. Quality
//     stays acceptable for closet thumbnails.
//   - When the browser supports WebGPU we use it (`device: 'gpu'`).
//     That's a 5-10x speedup over WASM CPU.
//
// All knobs can be overridden per call via the `config` argument.

const LIB_URL = "/vendor/imgly/index.mjs";
const LOCAL_PUBLIC_PATH = "/vendor/imgly/";
const IMGLY_DATA_VERSION = "1.7.0";
const CDN_PUBLIC_PATH = `https://staticimgly.com/@imgly/background-removal-data/${IMGLY_DATA_VERSION}/dist/`;

const MAX_INPUT_DIM = 1280;
const MODEL: "small" | "medium" = "small";

type RemoveOptions = {
  publicPath?: string;
  model?: "small" | "medium" | "large";
  device?: "cpu" | "gpu";
  proxyToWorker?: boolean;
  output?: { format?: string; quality?: number; type?: string };
  debug?: boolean;
};

type RemoveBackground = (input: Blob, config?: RemoveOptions) => Promise<Blob>;

let _removerPromise: Promise<RemoveBackground> | null = null;
let _publicPath: string | null = null;
// Cached config decisions so we don't probe every call.
let _device: "cpu" | "gpu" | null = null;
let _lastDurationMs: number | null = null;

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

function pickDevice(): "cpu" | "gpu" {
  if (_device) return _device;
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    _device = "gpu";
  } else {
    _device = "cpu";
  }
  return _device;
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

// Downscale to MAX_INPUT_DIM on the long edge if needed. Returns the input
// unchanged when it's already small enough. JPEG output keeps file size
// reasonable; the bg removal output is PNG with alpha and is generated
// downstream regardless.
async function downscale(input: Blob, maxDim = MAX_INPUT_DIM): Promise<Blob> {
  if (typeof document === "undefined") return input;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input);
  } catch {
    return input;
  }
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= maxDim) {
    bitmap.close?.();
    return input;
  }
  const ratio = maxDim / longEdge;
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return input;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? input), "image/jpeg", 0.92);
  });
}

// Single in-flight chain so concurrent removeBackground() calls don't
// race the ONNX session.
let _queue: Promise<unknown> = Promise.resolve();

export async function removeBackground(input: Blob): Promise<Blob> {
  const next = _queue.then(async () => {
    const remove = await getRemover();
    const publicPath = await pickPublicPath();
    const device = pickDevice();
    const small = await downscale(input);
    const opts: RemoveOptions = { publicPath, model: MODEL, device };
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const out = await remove(small, opts);
      _lastDurationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
      return out;
    } catch (err) {
      // If we were on local and it bombed mid-removal, retry once on the
      // CDN. Also retry once on CPU if GPU failed (some devices report
      // navigator.gpu but lack required features).
      if (publicPath === LOCAL_PUBLIC_PATH) {
        console.warn("Local bg removal failed, retrying via CDN:", err);
        _publicPath = CDN_PUBLIC_PATH;
        return await remove(small, { ...opts, publicPath: CDN_PUBLIC_PATH });
      }
      if (device === "gpu") {
        console.warn("GPU bg removal failed, retrying on CPU:", err);
        _device = "cpu";
        return await remove(small, { ...opts, device: "cpu" });
      }
      throw err;
    }
  });
  _queue = next.catch(() => {});
  return next as Promise<Blob>;
}

export function resetBackgroundRemover() {
  _removerPromise = null;
  _publicPath = null;
  _device = null;
}

export function currentPublicPath(): string | null {
  return _publicPath;
}

export function lastDurationMs(): number | null {
  return _lastDurationMs;
}

export function currentDevice(): "cpu" | "gpu" | null {
  return _device;
}
