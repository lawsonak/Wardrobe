"use client";

// Loads @imgly/background-removal from the locally-served bundle in
// public/vendor/imgly/. The model + WASM assets live next to it (fetched
// once by `npm run fetch-vendor`). No CDN calls at runtime once the vendor
// directory is populated.

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
      const mod = (await import(/* webpackIgnore: true */ LIB_URL)) as {
        removeBackground?: RemoveBackground;
      };
      const fn = mod.removeBackground;
      if (typeof fn !== "function") {
        throw new Error("background-removal module missing removeBackground()");
      }
      return fn;
    })();
  }
  return _removerPromise;
}

export async function removeBackground(input: Blob): Promise<Blob> {
  const remove = await getRemover();
  return remove(input, { publicPath: PUBLIC_PATH });
}
