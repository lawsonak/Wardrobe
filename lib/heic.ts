"use client";

// Client-side HEIC/HEIF -> JPEG conversion. Browsers can't decode HEIC
// natively, and our background-removal pipeline + <img> previews need a
// browser-decodable format. heic2any is loaded on demand from a CDN to
// avoid pulling its libheif WASM into the bundle.

const CDN_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm";

type Heic2Any = (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;

let _heic2anyPromise: Promise<Heic2Any> | null = null;

async function getHeic2Any(): Promise<Heic2Any> {
  if (!_heic2anyPromise) {
    _heic2anyPromise = (async () => {
      const mod = (await import(/* webpackIgnore: true */ CDN_URL)) as { default?: Heic2Any };
      const fn = mod.default;
      if (typeof fn !== "function") throw new Error("heic2any module has no default export");
      return fn;
    })();
  }
  return _heic2anyPromise;
}

export function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")) return true;
  const t = file.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || t === "image/x-heic" || t === "image/x-heif";
}

export async function heicToJpeg(file: File, quality = 0.92): Promise<File> {
  const heic2any = await getHeic2Any();
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality });
  const blob = Array.isArray(out) ? out[0] : out;
  const baseName = file.name.replace(/\.(heic|heif)$/i, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}
