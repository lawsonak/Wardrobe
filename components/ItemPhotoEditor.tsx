"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";

// Two stacked controls for the item-detail page:
// 1. Replace the main photo (re-runs HEIC + bg removal + saves both
//    variants on the server, deletes the previous files).
// 2. Add / replace / remove the label / tag photo.

export default function ItemPhotoEditor({
  itemId,
  hasLabelPhoto,
}: {
  itemId: string;
  hasLabelPhoto: boolean;
}) {
  const router = useRouter();

  const mainFileRef = useRef<HTMLInputElement>(null);
  const mainCameraRef = useRef<HTMLInputElement>(null);
  const labelFileRef = useRef<HTMLInputElement>(null);
  const labelCameraRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
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
      setStage("Removing background…");
      let bgBlob: Blob | null = null;
      try {
        bgBlob = await removeBackground(file);
      } catch (err) {
        console.error("bg removal failed", err);
        bgBlob = null;
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

  return (
    <div className="space-y-3">
      <input ref={mainFileRef} type="file" accept="image/*,.heic,.heif" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceMain(f); }} />
      <input ref={mainCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceMain(f); }} />
      <input ref={labelFileRef} type="file" accept="image/*,.heic,.heif" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceLabel(f); }} />
      <input ref={labelCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceLabel(f); }} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => mainCameraRef.current?.click()} className="btn-secondary text-xs">
          📸 Replace photo
        </button>
        <button type="button" disabled={busy} onClick={() => mainFileRef.current?.click()} className="btn-ghost text-xs">
          From library
        </button>
        <span className="grow" />
        <button type="button" disabled={busy} onClick={() => labelCameraRef.current?.click()} className="btn-secondary text-xs">
          🏷️ {hasLabelPhoto ? "Replace label" : "Add label / tag"}
        </button>
        {hasLabelPhoto && (
          <button type="button" disabled={busy} onClick={clearLabel} className="btn-ghost text-xs text-stone-400">
            Remove label
          </button>
        )}
      </div>

      {(busy || error) && (
        <p className="text-xs text-stone-500">
          {busy && stage}
          {error && <span className="text-blush-700">{error} <button onClick={() => { resetBackgroundRemover(); setError(null); }} className="underline">retry</button></span>}
        </p>
      )}
    </div>
  );
}
