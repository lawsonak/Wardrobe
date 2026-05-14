"use client";

import { useEffect, useRef, useState } from "react";

// Reusable barcode capture UI. Two paths:
//
//   1. Modern browsers (iOS 17+ Safari, Chrome 88+, Edge): native
//      `BarcodeDetector` API via getUserMedia + a <video> element.
//      Continuous detection on each animation frame; first hit fires
//      onDetect. ~5 KB of JS, no library.
//
//   2. Older / unsupported browsers: graceful fallback to a manual
//      text input that accepts the 8-14 digit code typed by hand.
//
// HTTPS is required for getUserMedia + BarcodeDetector outside of
// localhost. In dev (PORT=3001 npm run dev) the camera path works on
// http://localhost:3001 because browsers exempt localhost from the
// secure-context requirement.
//
// Renders as a sheet overlay when `open` is true; backdrop tap (or
// the Cancel button) closes without firing.
//
// Props:
//   open       — render the sheet
//   onDetect   — fired with the normalized digit string when a barcode
//                is found (camera) or submitted (manual)
//   onCancel   — close without firing onDetect
type Props = {
  open: boolean;
  onDetect: (code: string) => void;
  onCancel: () => void;
};

// `BarcodeDetector` is a Web platform API that ships in Chrome /
// Edge and recent iOS Safari, but TypeScript's lib doesn't include
// the type yet. Declare the minimum shape we use.
type BarcodeDetectorCtor = new (init?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource | ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};
declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];

export default function BarcodeScanner({ open, onDetect, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<InstanceType<BarcodeDetectorCtor> | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  // Detect browser support exactly once on mount. Runs client-side
  // so it never blocks SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setSupported(true);
  }, []);

  // Start / stop the camera based on `open`. Cleans up the stream +
  // RAF loop every time the sheet closes so we don't leak the
  // camera permission indicator when the user dismisses without
  // capturing.
  useEffect(() => {
    if (!open || !supported) return;
    let cancelled = false;

    (async () => {
      firedRef.current = false;
      setCameraError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (window.BarcodeDetector) {
          detectorRef.current = new window.BarcodeDetector({ formats: FORMATS });
        }

        // Detect on every animation frame. Cheap on modern hardware
        // (the API runs natively); first hit calls onDetect and
        // closes the loop.
        const tick = async () => {
          if (cancelled || firedRef.current) return;
          const v = videoRef.current;
          const d = detectorRef.current;
          if (v && d && v.readyState >= 2) {
            try {
              const results = await d.detect(v);
              if (!cancelled && results.length > 0 && results[0].rawValue) {
                firedRef.current = true;
                const code = results[0].rawValue.replace(/\D+/g, "");
                if (code.length >= 8 && code.length <= 14) {
                  onDetect(code);
                  return;
                }
                // QR / non-numeric — keep scanning.
                firedRef.current = false;
              }
            } catch {
              /* swallow per-frame detect errors; the loop retries */
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Camera unavailable";
        // Common case: user denied permission. Surface a clear hint
        // rather than the raw DOM exception.
        if (/denied|notallowed/i.test(message)) {
          setCameraError("Camera permission denied. Type the barcode by hand instead.");
        } else {
          setCameraError(message);
        }
      }
    })();

    // Capture the ref into a local so the cleanup function isn't
    // closing over the live ref (which React's lint rule flags
    // because the node may have been unmounted by the time cleanup
    // runs).
    const video = videoRef.current;
    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
    // onDetect is stable in practice (called once); re-running when
    // `open` toggles is the only behavior we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supported]);

  if (!open) return null;

  function submitManual() {
    const code = manualCode.replace(/\D+/g, "");
    if (code.length < 8 || code.length > 14) return;
    onDetect(code);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 p-4 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md space-y-3 p-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg text-stone-800">Scan barcode</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-stone-500 hover:text-blush-600"
          >
            Cancel
          </button>
        </div>

        {/* Camera viewport — only rendered when supported. The fall-
            back path skips this entirely and shows just the manual
            input below. */}
        {supported && (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl bg-stone-900">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-56 w-full object-cover"
              />
            </div>
            <p className="text-xs text-stone-500">
              Point your camera at the barcode. We&rsquo;ll grab it
              automatically.
            </p>
            {cameraError && (
              <p className="text-xs text-blush-700">{cameraError}</p>
            )}
          </div>
        )}

        {supported === false && (
          <p className="text-xs text-stone-500">
            Camera scanning isn&rsquo;t supported on this browser. Type the
            barcode below.
          </p>
        )}

        {/* Manual entry — always visible so the user can type even when
            the camera is open (e.g. the barcode is too small to focus
            on). */}
        <div className="space-y-1">
          <label htmlFor="bc-manual" className="label">
            Or enter manually
          </label>
          <div className="flex gap-2">
            <input
              id="bc-manual"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.replace(/[^0-9\s-]/g, ""))}
              placeholder="0 12345 67890 5"
              maxLength={20}
              className="input flex-1"
            />
            <button
              type="button"
              onClick={submitManual}
              disabled={manualCode.replace(/\D+/g, "").length < 8}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Look up
            </button>
          </div>
          <p className="text-[10px] text-stone-400">
            8-14 digits. Spaces and dashes are stripped automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
