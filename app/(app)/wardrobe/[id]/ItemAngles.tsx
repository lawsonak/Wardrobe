"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import ProgressBar from "@/components/ProgressBar";

export type Angle = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  label: string | null;
};

// Adds + removes additional photo angles for an item. Mirrors the
// primary photo flow: HEIC → JPEG, optional bg removal, then a
// multipart POST. The thumbnail strip below shows existing angles
// with a × delete on each.
export default function ItemAngles({
  itemId,
  angles,
  editing = false,
}: {
  itemId: string;
  angles: Angle[];
  editing?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [bgProgress, setBgProgress] = useState(0);
  const [bgPhase, setBgPhase] = useState<"fetch" | "compute" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(picked: File) {
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
      } finally {
        setBgPhase(null);
      }
      setStage("Saving…");
      const fd = new FormData();
      fd.append("image", file);
      if (bgBlob) fd.append("imageBgRemoved", new File([bgBlob], "bg.png", { type: "image/png" }));
      const res = await fetch(`/api/items/${itemId}/photos`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      haptic("success");
      toast("Angle added");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't add the photo.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function remove(photoId: string) {
    const ok = await confirmDialog({
      title: "Remove this angle?",
      body: "The photo will be deleted.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/items/${itemId}/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Angle removed");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't remove angle", "error");
    }
  }

  // Read-only thumbnail strip (no add / remove controls).
  if (!editing && angles.length === 0) return null;

  return (
    <div className="space-y-2">
      {angles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {angles.map((a) => {
            const src = a.imageBgRemovedPath
              ? `/api/uploads/${a.imageBgRemovedPath}`
              : `/api/uploads/${a.imagePath}`;
            return (
              <div key={a.id} className="relative">
                <a
                  href={`/api/uploads/${a.imagePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tile-bg flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100"
                  title={a.label ?? "Open full size"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={a.label ?? "Angle"} className="h-full w-full object-contain p-1" />
                </a>
                {editing && (
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    aria-label="Remove angle"
                    className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-stone-500 shadow-card ring-1 ring-stone-200 hover:text-blush-600"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                {a.label && (
                  <p className="mt-0.5 truncate text-center text-[10px] text-stone-500">{a.label}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (e.target) e.target.value = "";
              if (f) add(f);
            }}
            aria-label="Choose photo angle from library"
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (e.target) e.target.value = "";
              if (f) add(f);
            }}
            aria-label="Take photo angle with camera"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => cameraRef.current?.click()}
              className="btn-secondary text-xs"
            >
              📸 Add another angle
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="btn-ghost text-xs"
            >
              From library
            </button>
            {error && (
              <p className="text-xs text-blush-700">
                {error}{" "}
                <button
                  onClick={() => {
                    resetBackgroundRemover();
                    setError(null);
                  }}
                  className="underline"
                >
                  retry
                </button>
              </p>
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
        </>
      )}
    </div>
  );
}
