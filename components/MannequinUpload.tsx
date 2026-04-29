"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { heicToJpeg, isHeic } from "@/lib/heic";

type Info = {
  url: string | null;
  hasSource: boolean;
  hasLandmarks: boolean;
};

// Settings panel for the per-user "custom mannequin" feature.
//
// Lifecycle:
//   1. Upload → POST multipart → server saves source, generates the
//      illustration, and extracts landmarks (anchor points on the
//      figure). Used everywhere the canvas places clothes.
//   2. "Regenerate" → POST { mode: "regenerate" } → re-run on saved
//      source; landmarks are re-extracted on the new render.
//   3. "Recalibrate fit" → POST { mode: "recalibrate" } → re-extract
//      landmarks from the existing mannequin without regenerating
//      (useful if the auto-extract failed or items look misaligned).
//   4. "Reset" → DELETE → mannequin, source, and landmarks all go.
export default function MannequinUpload({ initial }: { initial: Info }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Info>(initial);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "generating" | "calibrating">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInfo(initial);
  }, [initial]);

  async function refresh() {
    try {
      const res = await fetch("/api/mannequin");
      if (!res.ok) return;
      const data = (await res.json()) as Info;
      setInfo(data);
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!picked) return;

    setBusy(true);
    setPhase("preparing");
    setError(null);

    let file = picked;
    try {
      if (isHeic(picked)) {
        file = await heicToJpeg(picked);
      }
    } catch (err) {
      console.error("HEIC conversion failed", err);
      setError("Couldn't read that HEIC photo. Try saving it as JPEG first.");
      setBusy(false);
      setPhase("idle");
      return;
    }

    try {
      setPhase("generating");
      const fd = new FormData();
      fd.append("source", file);
      const res = await fetch("/api/mannequin", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setInfo({
        url: data.url ?? null,
        hasSource: data.hasSource ?? true,
        hasLandmarks: data.hasLandmarks ?? false,
      });
      if (data.calibrationError) {
        toast("Mannequin generated · couldn't auto-calibrate fit", "info");
        setError(`Auto-calibration failed: ${data.calibrationError}. Tap "Recalibrate fit" to retry.`);
      } else {
        toast("Mannequin generated");
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't generate mannequin", "error");
      await refresh();
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function regenerate() {
    setBusy(true);
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/mannequin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "regenerate" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setInfo({
        url: data.url ?? null,
        hasSource: data.hasSource ?? true,
        hasLandmarks: data.hasLandmarks ?? false,
      });
      if (data.calibrationError) {
        toast("Mannequin regenerated · couldn't auto-calibrate fit", "info");
        setError(`Auto-calibration failed: ${data.calibrationError}.`);
      } else {
        toast("Mannequin regenerated");
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't regenerate", "error");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function recalibrate() {
    setBusy(true);
    setPhase("calibrating");
    setError(null);
    try {
      const res = await fetch("/api/mannequin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "recalibrate" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setInfo({
        url: data.url ?? null,
        hasSource: data.hasSource ?? true,
        hasLandmarks: data.hasLandmarks ?? false,
      });
      toast("Fit recalibrated");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't recalibrate", "error");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Use the default mannequin?",
      body: "Your uploaded photo, the generated illustration, and the fit calibration will be deleted. You can upload again any time.",
      confirmText: "Reset",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mannequin", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo({ url: null, hasSource: false, hasLandmarks: false });
      toast("Mannequin reset");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't reset", "error");
    } finally {
      setBusy(false);
    }
  }

  const phaseLabel =
    phase === "preparing"
      ? "Preparing photo…"
      : phase === "generating"
        ? "Drawing your mannequin… (this can take 10-30 seconds)"
        : phase === "calibrating"
          ? "Calibrating fit…"
          : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="tile-bg flex h-48 w-24 shrink-0 items-end justify-center overflow-hidden rounded-2xl ring-1 ring-stone-100 sm:h-64 sm:w-32">
          {info.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.url} alt="Your mannequin" className="h-full w-full object-contain" />
          ) : (
            <div className="grid h-full w-full place-items-center text-center text-xs text-stone-400">
              Default silhouette
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-sm text-stone-600">
          {info.url ? (
            <>
              <p>
                You&apos;re using your custom mannequin in the outfit style canvas.
                {info.hasSource && " You can regenerate to try a different illustration without re-uploading."}
              </p>
              {info.hasLandmarks ? (
                <p className="text-xs text-sage-600">✓ Fit calibrated to your mannequin&apos;s body.</p>
              ) : (
                <p className="text-xs text-amber-700">
                  Fit not calibrated yet — clothes will use generic positions until you tap
                  &ldquo;Recalibrate fit&rdquo;.
                </p>
              )}
            </>
          ) : (
            <p>
              Upload a clear, well-lit photo of yourself (head-to-toe is best). We&apos;ll send it to
              Gemini and turn it into a soft fashion-illustration mannequin you can dress in the
              style canvas.
            </p>
          )}
          <p className="text-xs text-stone-500">
            Privacy: your photo is sent to Google&apos;s Gemini API to generate the illustration. The
            illustration is stored on your server. You can reset (delete all files) any time.
          </p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={onFile}
        className="hidden"
        aria-label="Choose photo for mannequin"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {info.url ? "📸 Upload a new photo" : "📸 Upload your photo"}
        </button>
        {info.hasSource && (
          <button
            type="button"
            className="btn-secondary"
            onClick={regenerate}
            disabled={busy}
            title="Re-run the AI on the same photo"
          >
            ✨ Regenerate
          </button>
        )}
        {info.url && (
          <button
            type="button"
            className="btn-secondary"
            onClick={recalibrate}
            disabled={busy}
            title="Re-extract body anchor points (helps when clothes look misaligned)"
          >
            📐 Recalibrate fit
          </button>
        )}
        {(info.url || info.hasSource) && (
          <button
            type="button"
            className="btn-ghost text-stone-500"
            onClick={reset}
            disabled={busy}
          >
            Reset to default
          </button>
        )}
        {phaseLabel && <span className="text-xs text-stone-500">{phaseLabel}</span>}
      </div>

      {error && (
        <div className="rounded-xl bg-blush-50 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          {error}
        </div>
      )}
    </div>
  );
}
