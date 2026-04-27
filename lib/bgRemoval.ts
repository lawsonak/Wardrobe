"use client";

// Load @imgly/background-removal from a CDN at runtime, bypassing the
// bundler. The library ships ONNX runtime ESM assets that webpack can't
// process, so we use a webpackIgnore'd dynamic import. The browser caches
// the module and model weights after first use, so subsequent uploads work
// offline. If the CDN is unreachable, callers fall back to the original
// photo and surface the failure in the UI.
const CDN_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm";

let _removerPromise: Promise<(input: Blob) => Promise<Blob>> | null = null;

async function getRemover() {
  if (!_removerPromise) {
    _removerPromise = (async () => {
      const mod = await import(/* webpackIgnore: true */ CDN_URL);
      const fn = (mod as unknown as { removeBackground: (input: Blob) => Promise<Blob> })
        .removeBackground;
      if (typeof fn !== "function") throw new Error("background-removal module missing removeBackground()");
      return fn;
    })();
  }
  return _removerPromise;
}

export async function removeBackground(input: Blob): Promise<Blob> {
  const remove = await getRemover();
  return remove(input);
}
