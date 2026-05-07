"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation } from "@/lib/imageOrientation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import ZoomableImage from "@/components/ZoomableImage";

export type Label = {
  id: string;
  imagePath: string;
  imageOriginalPath: string | null;
};

// Adds + removes label / tag photos on an item. Mirrors ItemAngles
// but skips client-side background removal — labels are flat tag
// photos, no figure to cut out — and uses kind="label" on the
// shared /api/items/[id]/photos endpoint. Each thumbnail opens the
// lightbox with rotate controls, same gesture surface as everywhere
// else photos appear.
export default function ItemLabels({
  itemId,
  labels,
  editing = false,
}: {
  itemId: string;
  labels: Label[];
  editing?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
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
      try {
        file = await normalizeOrientation(file);
      } catch (err) {
        console.warn("orientation normalize failed", err);
      }
      setStage("Saving…");
      const fd = new FormData();
      fd.append("image", file);
      fd.append("kind", "label");
      const res = await fetch(`/api/items/${itemId}/photos`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      haptic("success");
      toast("Label added");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't add the label.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function remove(photoId: string) {
    const ok = await confirmDialog({
      title: "Remove this label?",
      body: "The photo will be deleted.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/items/${itemId}/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Label removed");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't remove label", "error");
    }
  }

  function rotateLabel(photoId: string) {
    return async (degrees: 90 | 270) => {
      const res = await fetch(`/api/items/${itemId}/photos/${photoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ degrees }),
      });
      if (!res.ok) {
        toast("Couldn't rotate the label", "error");
        return;
      }
      router.refresh();
    };
  }

  if (!editing && labels.length === 0) return null;

  return (
    <div className="space-y-2">
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {labels.map((l) => {
            const src = `/api/uploads/${l.imagePath}`;
            const zoomSrc = l.imageOriginalPath
              ? `/api/uploads/${l.imageOriginalPath}`
              : src;
            return (
              <div key={l.id} className="relative">
                <div className="tile-bg flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100">
                  <ZoomableImage
                    src={src}
                    zoomSrc={zoomSrc}
                    alt="Label tag"
                    className="h-full w-full object-contain p-1"
                    onRotate={editing ? rotateLabel(l.id) : undefined}
                  />
                </div>
                {editing && (
                  <button
                    type="button"
                    onClick={() => remove(l.id)}
                    aria-label="Remove label"
                    className="absolute -right-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-white text-stone-500 shadow-card ring-1 ring-stone-200 hover:text-blush-600"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
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
              e.target.value = "";
              if (f) add(f);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="btn-secondary text-xs"
            >
              {busy ? stage ?? "Working…" : "📸 Add label"}
            </button>
            {error && <span className="text-xs text-blush-700">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
