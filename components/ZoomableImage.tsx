"use client";

import { useEffect, useRef, useState } from "react";

// Click an image to open it fullscreen. The lightbox implements its
// own pinch-zoom + pan + double-tap + wheel handling because the root
// layout sets `userScalable: false` on the viewport meta — mobile
// browsers honor that across the whole page, so the OS-level pinch
// gesture is disabled. Re-enabling it just for this surface via JS
// is the only reliable way to give her a working zoom on a phone
// without letting the closet grid accidentally zoom too.
//
// `zoomSrc` is an optional separate URL used only inside the lightbox —
// we render a small display variant inline (fast LAN load, fewer pixels
// to decode for grids) and load the untouched original on demand when
// the user actually taps to zoom. Falls back to `src` when no original
// exists (older items, generated artifacts).
//
// `onRotate` is an optional callback. When provided, the lightbox
// renders a small ↺ / ↻ toolbar in the top-left so the user can rotate
// the photo from any place a photo is viewed (hero, angle, label).
// The callback is responsible for the round-trip — typically firing
// the relevant /api/.../rotate endpoint and calling router.refresh().

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;

export default function ZoomableImage({
  src,
  zoomSrc,
  alt,
  className,
  draggable,
  onRotate,
}: {
  src: string;
  zoomSrc?: string;
  alt: string;
  className?: string;
  draggable?: boolean;
  onRotate?: (degrees: 90 | 270) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const lightboxSrc = zoomSrc ?? src;

  // Active pointers we're tracking on the image. Pointer events make
  // touch / mouse / pen all the same shape — no need to wire separate
  // touch + mouse handlers.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Snapshot of the world at the moment a 2-finger pinch began, so
  // each gesture computes its delta from a stable reference instead
  // of compounding noise frame-to-frame.
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const lastTapAt = useRef(0);
  const gestureCount = useRef(0); // tracks "are we mid-gesture?" for the transition

  async function rotate(degrees: 90 | 270) {
    if (!onRotate || rotating) return;
    setRotating(true);
    try {
      await onRotate(degrees);
    } finally {
      setRotating(false);
    }
  }

  function close() {
    setOpen(false);
  }

  // Reset zoom every time the lightbox closes so the next open starts
  // fit-to-screen rather than wherever the user left off.
  useEffect(() => {
    if (!open) {
      setScale(1);
      setTx(0);
      setTy(0);
      pointers.current.clear();
      pinchStart.current = null;
      gestureCount.current = 0;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStart.current = { dist, scale };
      gestureCount.current++;
    } else if (pointers.current.size === 1) {
      // Double-tap: zoom toggle.
      const now = Date.now();
      if (now - lastTapAt.current < DOUBLE_TAP_MS) {
        if (scale === 1) {
          setScale(DOUBLE_TAP_SCALE);
        } else {
          setScale(1);
          setTx(0);
          setTy(0);
        }
        lastTapAt.current = 0;
      } else {
        lastTapAt.current = now;
      }
      gestureCount.current++;
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / pinchStart.current.dist;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.scale * ratio));
      setScale(next);
      // Snap pan back to centre when the user pinches all the way out.
      if (next === 1) {
        setTx(0);
        setTy(0);
      }
    } else if (pointers.current.size === 1 && scale > 1) {
      setTx((prev) => prev + e.movementX);
      setTy((prev) => prev + e.movementY);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) gestureCount.current = 0;
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!open) return;
    // Mouse wheel + trackpad pinch both come through here. Negative
    // deltaY = scroll up / pinch out → zoom in. Multiplier keeps the
    // ramp gentle on a high-resolution trackpad.
    e.preventDefault();
    const delta = -e.deltaY * 0.0025;
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * (1 + delta)));
      if (next === 1) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }

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
          onClick={close}
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/80 p-4 backdrop-blur-sm"
          style={{
            paddingTop: "max(1rem, env(safe-area-inset-top))",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className="relative grid h-full max-h-full w-full max-w-5xl place-items-center overflow-hidden"
            // touch-action: none so the browser doesn't intercept the
            // gesture for native scroll / pinch (which is disabled by
            // the page-level user-scalable=no anyway, but explicit is
            // better here).
            style={{ touchAction: "none" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxSrc}
              alt={alt}
              draggable={false}
              className="block h-auto w-auto max-w-full select-none"
              style={{
                maxHeight: "100%",
                objectFit: "contain",
                transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
                transformOrigin: "center center",
                // Snap-back animation when the user lets go; instant
                // during an active gesture so the image tracks the
                // fingers without lag.
                transition:
                  gestureCount.current === 0 && pointers.current.size === 0
                    ? "transform 0.18s ease-out"
                    : "none",
                willChange: "transform",
                cursor: scale > 1 ? "grab" : "zoom-in",
              }}
            />
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          {onRotate && (
            <div
              className="absolute left-4 top-4 flex items-center gap-2"
              style={{ top: "max(1rem, env(safe-area-inset-top))" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => rotate(270)}
                disabled={rotating}
                aria-label="Rotate 90° counter-clockwise"
                title="Rotate 90° counter-clockwise"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4v5h5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => rotate(90)}
                disabled={rotating}
                aria-label="Rotate 90° clockwise"
                title="Rotate 90° clockwise"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-3-6.7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 4v5h-5" />
                </svg>
              </button>
              {rotating && (
                <span className="text-xs text-white/80" aria-live="polite">
                  Rotating…
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
