"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import ProgressBar from "@/components/ProgressBar";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { useTimedProgress } from "@/lib/progress";

type Info = {
  url: string | null;
  hasSource: boolean;
  id: string | null;
  headUrl: string | null;
  headBBox: { x: number; y: number; w: number; h: number } | null;
};

// Settings panel for the per-user "personal mannequin".
//
// Lifecycle:
//   1. Upload → POST multipart → server saves the source photo and
//      asks Gemini for a stylized illustration. The illustration is
//      saved as the user's canonical mannequin and used by the AI
//      try-on instead of the global default.
//   2. "Regenerate" → POST { mode: "regenerate" } → re-run on the saved
//      source (the model is non-deterministic; results vary).
//   3. "Reset" → DELETE → wipes the source + illustration. The user
//      goes back to the global default mannequin for try-ons.
export default function MannequinUpload({ initial }: { initial: Info }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Info>(initial);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "generating">("idle");
  const generationProgress = useTimedProgress(phase === "generating", 12);
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
        id: data.id ?? null,
        headUrl: data.headUrl ?? null,
        headBBox: data.headBBox ?? null,
      });
      haptic("success");
      toast("Mannequin generated");
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
        id: data.id ?? null,
        headUrl: data.headUrl ?? null,
        headBBox: data.headBBox ?? null,
      });
      toast("Mannequin regenerated");
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

  async function regenerateFace() {
    setBusy(true);
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/mannequin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "regenerate-face" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setInfo({
        url: data.url ?? null,
        hasSource: data.hasSource ?? true,
        id: data.id ?? null,
        headUrl: data.headUrl ?? null,
        headBBox: data.headBBox ?? null,
      });
      toast(data.headUrl ? "Face overlay updated" : "Couldn't generate face — check the source photo");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't regenerate face", "error");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function removeFace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mannequin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "remove-face" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setInfo({
        url: data.url ?? null,
        hasSource: data.hasSource ?? true,
        id: data.id ?? null,
        headUrl: null,
        headBBox: null,
      });
      toast("Face overlay removed");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      toast("Couldn't remove face", "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Use the default mannequin?",
      body: "Your uploaded photo, the generated illustration, and any face overlay will be deleted. You can upload again any time.",
      confirmText: "Reset",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mannequin", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo({ url: null, hasSource: false, id: null, headUrl: null, headBBox: null });
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="tile-bg flex h-48 w-24 shrink-0 items-end justify-center overflow-hidden rounded-2xl ring-1 ring-stone-100 sm:h-64 sm:w-32">
          {info.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.url} alt="Your mannequin" className="h-full w-full object-contain" />
          ) : (
            <div className="grid h-full w-full place-items-center text-center text-xs text-stone-400">
              Default mannequin
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-sm text-stone-600">
          {info.url ? (
            <p>
              You&apos;re using a personal mannequin generated from your photo. Try-ons will be
              composited on this figure instead of the default.
              {info.hasSource && " Regenerate to try a different illustration without re-uploading."}
            </p>
          ) : (
            <p>
              Upload a clear, well-lit, full-body photo of yourself. We&apos;ll send it to Gemini and
              turn it into a neutral fashion-illustration mannequin matching your body type. The
              illustration becomes your personal try-on figure.
            </p>
          )}
          {info.url && (
            <div className="flex items-center gap-2 text-xs">
              {info.headUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={info.headUrl}
                    alt="Stylized face overlay"
                    className="h-10 w-10 rounded-full bg-stone-50 object-contain ring-1 ring-stone-200"
                  />
                  <span className="text-sage-600">✓ Face overlay on</span>
                  <span className="text-stone-400">— shows on every try-on. Remove any time.</span>
                </>
              ) : (
                <span className="text-stone-500">
                  No face overlay. Add one for a more personal try-on, or skip if you prefer the
                  faceless mannequin look.
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-stone-500">
            Privacy: the photo is sent to Google&apos;s Gemini API to generate the illustration
            (and an optional stylized head). Files are stored on your server. The mannequin&apos;s
            body is generated without facial features; the optional face overlay is a separate
            redrawing matched to the illustration style. Reset any time to delete everything.
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
        {info.url && info.hasSource && info.headUrl && (
          <button
            type="button"
            className="btn-ghost text-stone-500"
            onClick={removeFace}
            disabled={busy}
            title="Remove the AI-generated face overlay (mannequin stays)"
          >
            Remove face
          </button>
        )}
        {info.url && info.hasSource && !info.headUrl && (
          <button
            type="button"
            className="btn-secondary"
            onClick={regenerateFace}
            disabled={busy}
            title="Generate a stylized head from your photo to overlay on try-ons"
          >
            ✨ Add my face
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
      </div>

      {phase === "generating" && (
        <ProgressBar value={generationProgress} label="Drawing your mannequin…" hint="usually 5–15s" />
      )}
      {phase === "preparing" && (
        <p className="text-xs text-stone-500">Preparing photo…</p>
      )}

      {error && (
        <div className="rounded-xl bg-blush-50 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          {error}
        </div>
      )}
    </div>
  );
}
