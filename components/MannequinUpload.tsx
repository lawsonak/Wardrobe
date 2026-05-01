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
};

// Settings panel for the per-user "personal mannequin".
//
// Lifecycle:
//   1. Upload → POST multipart → server saves the source photo and runs
//      the three-step Gemini pipeline (body → cartoon head → compose).
//      The composed mannequin replaces the global default for try-ons.
//   2. "Regenerate" → POST { mode: "regenerate" } → re-run the full
//      pipeline on the saved source (results vary).
//   3. "Reset" → DELETE → wipes the source + illustration. The user
//      goes back to the global default mannequin.
export default function MannequinUpload({ initial }: { initial: Info }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Info>(initial);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "generating">("idle");
  // Three sequential Gemini calls now (body, head, compose). 30s is a
  // realistic median; tail can hit 60s.
  const generationProgress = useTimedProgress(phase === "generating", 30);
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

  async function reset() {
    const ok = await confirmDialog({
      title: "Use the default mannequin?",
      body: "Your uploaded photo and the generated illustration will be deleted. You can upload again any time.",
      confirmText: "Reset",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mannequin", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo({ url: null, hasSource: false, id: null });
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
              turn it into a fashion-illustration mannequin matching your body type, with a friendly
              cartoon portrait of you composed onto it.
            </p>
          )}
          <p className="text-xs text-stone-500">
            Privacy: the photo is sent to Google&apos;s Gemini API to generate the body, the cartoon
            head, and the composite. Files are stored on your server. Reset any time to delete
            everything.
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
        <ProgressBar value={generationProgress} label="Drawing your mannequin…" hint="usually 30–60s" />
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
