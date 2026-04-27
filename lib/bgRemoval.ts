"use client";

let _removerPromise: Promise<(input: Blob) => Promise<Blob>> | null = null;

async function getRemover() {
  if (!_removerPromise) {
    _removerPromise = import("@imgly/background-removal").then((mod) => {
      const fn = (mod as unknown as { removeBackground: (input: Blob) => Promise<Blob> })
        .removeBackground;
      return fn;
    });
  }
  return _removerPromise;
}

export async function removeBackground(input: Blob): Promise<Blob> {
  const remove = await getRemover();
  return remove(input);
}
