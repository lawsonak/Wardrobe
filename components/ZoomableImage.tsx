"use client";

import { useEffect, useRef, useState } from "react";

// Click an image to open it fullscreen. On touch devices the lightbox
// uses `touch-action: pinch-zoom` so the OS handles natural pinch + pan
// without us reinventing gesture math. On desktop, click the backdrop or
// hit Esc to close.
//
// `zoomSrc` is an optional separate URL used only inside the lightbox —
// we render a small display variant inline (fast LAN load, fewer pixels
// to decode for grids) and load the untouched original on demand when
// the user actually taps to zoom. Falls back to `src` when no original
// exists (older items, generated artifacts).
export default function ZoomableImage({
  src,
  zoomSrc,
  alt,
  className,
  draggable,
}: {
  src: string;
  zoomSrc?: string;
  alt: string;
  className?: string;
  draggable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lightboxSrc = zoomSrc ?? src;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        draggable={draggable}
        onClick={(e) => {
          // Don't fire if the parent already handles the click for nav.
          if (e.defaultPrevented) return;
          setOpen(true);
        }}
        style={{ cursor: "zoom-in" }}
      />
      {open && (
        <div
          role="dialog"
          aria-label={alt}
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div
            ref={scrollRef}
            onClick={(e) => e.stopPropagation()}
            className="relative h-full max-h-full w-full max-w-5xl overflow-auto"
            style={{ touchAction: "pinch-zoom" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxSrc}
              alt={alt}
              draggable={false}
              className="mx-auto block h-auto w-auto max-w-full select-none"
              style={{ maxHeight: "100%", objectFit: "contain" }}
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
