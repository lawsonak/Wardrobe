"use client";

// Client-side HEIC/HEIF -> JPEG. heic2any is a UMD bundle (no ESM build);
// served from public/vendor/heic2any/ and loaded via a <script> tag once.

const SCRIPT_URL = "/vendor/heic2any/heic2any.min.js";
const SCRIPT_ID = "heic2any-vendor";

type Heic2Any = (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;

declare global {
  interface Window {
    heic2any?: Heic2Any;
  }
}

let _loadPromise: Promise<Heic2Any> | null = null;

function loadScript(): Promise<Heic2Any> {
  if (typeof window === "undefined") return Promise.reject(new Error("heic2any: window not available"));
  if (window.heic2any) return Promise.resolve(window.heic2any);

  return new Promise<Heic2Any>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.heic2any) resolve(window.heic2any);
        else reject(new Error("heic2any did not register on window"));
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load heic2any")));
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => {
      if (window.heic2any) resolve(window.heic2any);
      else reject(new Error("heic2any did not register on window"));
    };
    s.onerror = () => reject(new Error("Failed to load heic2any"));
    document.head.appendChild(s);
  });
}

async function getHeic2Any(): Promise<Heic2Any> {
  if (!_loadPromise) _loadPromise = loadScript();
  return _loadPromise;
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
