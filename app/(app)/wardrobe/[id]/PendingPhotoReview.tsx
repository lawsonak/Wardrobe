"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import PhotoActionsSheet from "./PhotoActionsSheet";

// Pending-photo review panel — shown above the labels / angles
// strips on the item-edit page when the merge endpoint has folded
// uncategorized photos onto this item. Each row asks the user to
// pick a role (label or angle) or delete it. Rows disappear from
// this panel as they're resolved.
//
// Resolution PATCHes /api/items/[id]/photos/[photoId] with
// { kind: "label" | "angle" } and refreshes the page so the
// confirmed photo lands in the right strip below.
export type PendingPhoto = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
};

export default function PendingPhotoReview({
  itemId,
  photos,
}: {
  itemId: string;
  photos: PendingPhoto[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  if (photos.length === 0) return null;

  const activePhoto = photos.find((p) => p.id === activePhotoId);

  async function setKind(photoId: string, kind: "label" | "angle") {
    setBusy(photoId);
    try {
      const r = await fetch(`/api/items/${itemId}/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body?.error ?? "Couldn't update photo", "error");
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(photoId: string) {
    setBusy(photoId);
    try {
      const r = await fetch(`/api/items/${itemId}/photos/${photoId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body?.error ?? "Couldn't delete photo", "error");
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl bg-blush-50 p-3 ring-1 ring-blush-200">
      <p className="text-sm font-medium text-blush-800">
        Review {photos.length} merged photo{photos.length === 1 ? "" : "s"}
      </p>
      <p className="mt-1 text-xs text-blush-700">
        Was each one a tag / care label, or another angle of the
        garment? Pick a role or delete the photo if you don&rsquo;t need it.
      </p>
      <ul className="mt-3 space-y-3">
        {photos.map((p) => {
          const src = p.imageBgRemovedPath
            ? `/api/uploads/${p.imageBgRemovedPath}`
            : `/api/uploads/${p.imagePath}`;
          const isBusy = busy === p.id;
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-stone-100"
            >
              <div className="tile-bg h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-contain" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setKind(p.id, "label")}
                  disabled={isBusy}
                  className="btn-secondary text-xs"
                >
                  🏷 Tag / label
                </button>
                <button
                  type="button"
                  onClick={() => setKind(p.id, "angle")}
                  disabled={isBusy}
                  className="btn-secondary text-xs"
                >
                  📸 Angle
                </button>
                <button
                  type="button"
                  onClick={() => setActivePhotoId(p.id)}
                  disabled={isBusy}
                  className="btn-ghost text-xs text-stone-600"
                >
                  More…
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={isBusy}
                  className="btn-ghost text-xs text-stone-500"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {activePhoto && (
        <PhotoActionsSheet
          itemId={itemId}
          photo={{
            id: activePhoto.id,
            imagePath: activePhoto.imagePath,
            imageBgRemovedPath: activePhoto.imageBgRemovedPath,
            kind: "pending",
          }}
          onClose={() => setActivePhotoId(null)}
        />
      )}
    </div>
  );
}
