"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";
import ProgressBar from "@/components/ProgressBar";

// Two stacked controls for the item-detail page:
// 1. Replace the main photo (re-runs HEIC + bg removal + saves both
//    variants on the server, deletes the previous files).
// 2. Add / replace / remove the label / tag photo.

export default function ItemPhotoEditor({
  itemId,
  imagePath,
  hasBgRemoved,
  hasLabelPhoto,
}: {
  itemId: string;
  imagePath: string;
  hasBgRemoved: boolean;
  hasLabelPhoto: boolean;
}) {
  const router = useRouter();

  // One <input> per slot; `accept="image/*"` lets the OS prompt show
  // both "Take Photo" and "Photo Library" on mobile, so a separate
  // camera button isn't needed.
  const mainFileRef = useRef<HTMLInputElement>(null);
  const labelFileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [bgProgress, setBgProgress] = useState(0);
  const [bgPhase, setBgPhase] = useState<"fetch" | "compute" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function replaceMain(picked: File) {
    setError(null);
    setBusy(true);
    try {
      let file = picked;
      if (isHeic(picked)) {
        setStage("Converting HEIC…");
        file = await heicToJpeg(picked);
      }
      setStage(null);
      setBgProgress(0);
      let bgBlob: Blob | null = null;
      try {
        bgBlob = await removeBackground(file, {
          onProgress: (p) => {
            setBgPhase(p.phase);
            setBgProgress(p.fraction);
          },
        });
        setBgProgress(1);
      } catch (err) {
        console.error("bg removal failed", err);
        bgBlob = null;
      } finally {
        setBgPhase(null);
      }
      setStage("Saving…");
      const fd = new FormData();
      fd.append("which", "main");
      fd.append("image", file);
      if (bgBlob) fd.append("imageBgRemoved", new File([bgBlob], "bg.png", { type: "image/png" }));
      const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't replace the photo.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function replaceLabel(picked: File) {
    setError(null);
    setBusy(true);
    try {
      let file = picked;
      if (isHeic(picked)) {
        setStage("Converting HEIC…");
        file = await heicToJpeg(picked);
      }
      setStage("Saving…");
      const fd = new FormData();
      fd.append("which", "label");
      fd.append("label", file);
      const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't save the label.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function clearLabel() {
    if (!confirm("Remove the label / tag photo?")) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("which", "label-clear");
      const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't remove the label.");
    } finally {
      setBusy(false);
    }
  }

  // Re-run bg removal on the existing main photo (no re-upload). Fetches
  // the current image bytes from /api/uploads/, runs them through the
  // same client-side bg removal pipeline, then PATCHes only the bg
  // variant — original photo is untouched.
  async function rerunBgRemoval() {
    setError(null);
    setBusy(true);
    try {
      setStage("Loading photo…");
      const r = await fetch(`/api/uploads/${imagePath}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading photo`);
      const blob = await r.blob();
      setStage(null);
      setBgProgress(0);
      const out = await removeBackground(blob, {
        onProgress: (p) => {
          setBgPhase(p.phase);
          setBgProgress(p.fraction);
        },
      });
      setBgProgress(1);
      setBgPhase(null);
      setStage("Saving…");
      const fd = new FormData();
      fd.append("which", "bg");
      fd.append("imageBgRemoved", new File([out], "bg.png", { type: "image/png" }));
      const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Background removal failed.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function clearBgRemoval() {
    if (!confirm("Use the original photo and drop the background-removed version?")) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("which", "bg-clear");
      const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't drop the bg-removed photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input ref={mainFileRef} type="file" accept="image/*,.heic,.heif" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceMain(f); }} />
      <input ref={labelFileRef} type="file" accept="image/*,.heic,.heif" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceLabel(f); }} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => mainFileRef.current?.click()} className="btn-secondary text-xs">
          📸 Replace photo
        </button>
        <button type="button" disabled={busy} onClick={rerunBgRemoval} className="btn-ghost text-xs text-blush-600">
          ✂️ {hasBgRemoved ? "Re-run bg removal" : "Remove background"}
        </button>
        {hasBgRemoved && (
          <button type="button" disabled={busy} onClick={clearBgRemoval} className="btn-ghost text-xs text-stone-400">
            Use original
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => labelFileRef.current?.click()} className="btn-secondary text-xs">
          🏷️ {hasLabelPhoto ? "Replace label" : "Add label / tag"}
        </button>
        {hasLabelPhoto && (
          <button type="button" disabled={busy} onClick={clearLabel} className="btn-ghost text-xs text-stone-400">
            Remove label
          </button>
        )}
      </div>

      {busy && bgPhase && (
        <ProgressBar
          value={bgProgress}
          label={
            bgPhase === "fetch"
              ? "Loading model…"
              : bgPhase === "compute"
                ? "Removing background…"
                : "Preparing…"
          }
          hint={`${Math.round(bgProgress * 100)}%`}
        />
      )}
      {busy && !bgPhase && stage && (
        <p className="text-xs text-stone-500">{stage}</p>
      )}
      {error && (
        <p className="text-xs text-blush-700">
          {error}{" "}
          <button onClick={() => { resetBackgroundRemover(); setError(null); }} className="underline">
            retry
          </button>
        </p>
      )}
    </div>
  );
}
