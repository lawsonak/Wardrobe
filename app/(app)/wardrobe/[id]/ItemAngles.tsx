"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation } from "@/lib/imageOrientation";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import BgRetryControl from "@/components/BgRetryControl";
import ProgressBar from "@/components/ProgressBar";
import PhotoActionsSheet from "./PhotoActionsSheet";

export type Angle = {
  id: string;
  imagePath: string;
  imageOriginalPath: string | null;
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
  // Single <input>; `accept="image/*"` lets the OS prompt show both
  // "Take Photo" and "Photo Library" on mobile.
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [bgProgress, setBgProgress] = useState(0);
  const [bgPhase, setBgPhase] = useState<"fetch" | "compute" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  async function add(picked: File) {
    setError(null);
    setBusy(true);
    try {
      let file = picked;
      if (isHeic(picked)) {
        setStage("Converting HEIC…");
        file = await heicToJpeg(picked);
      }
      try {
        file = await normalizeOrientation(file);
      } catch (err) {
        console.warn("orientation normalize failed", err);
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

  // Read-only thumbnail strip (no add / remove controls).
  if (!editing && angles.length === 0) return null;

  const activePhoto = angles.find((a) => a.id === activePhotoId);

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
                {editing ? (
                  <button
                    type="button"
                    onClick={() => setActivePhotoId(a.id)}
                    className="tile-bg flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100 transition hover:ring-blush-300"
                    title={a.label ?? "Edit this angle"}
                    aria-label="Edit this angle photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={a.label ?? "Angle"} className="h-full w-full object-contain p-1" />
                  </button>
                ) : (
                  <div
                    className="tile-bg flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100"
                    title={a.label ?? undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={a.label ?? "Angle"} className="h-full w-full object-contain p-1" />
                  </div>
                )}
                {a.label && (
                  <p className="mt-0.5 truncate text-center text-[10px] text-stone-500">{a.label}</p>
                )}
                {editing && a.imageBgRemovedPath && (
                  <div className="mt-0.5 text-center">
                    <BgRetryControl itemId={itemId} photoId={a.id} variant="button" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && activePhoto && (
        <PhotoActionsSheet
          itemId={itemId}
          photo={{
            id: activePhoto.id,
            imagePath: activePhoto.imagePath,
            imageBgRemovedPath: activePhoto.imageBgRemovedPath,
            kind: "angle",
          }}
          onClose={() => setActivePhotoId(null)}
        />
      )}

      {editing && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (e.target) e.target.value = "";
              // Sequential rather than Promise.all so the existing busy
              // state + per-file error handling in `add()` keeps working
              // and the upload route isn't hammered with parallel POSTs
              // against the same item.
              for (const f of files) {
                await add(f);
              }
            }}
            aria-label="Add other angle photos"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="btn-secondary text-xs"
            >
              📸 Add angle photos
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
