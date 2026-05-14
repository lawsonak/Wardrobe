"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

// Bottom-sheet (mobile) / centered modal (desktop) for one ItemPhoto
// row. Lets the user re-classify the photo across the three roles
// the app knows about — main (Item.imagePath), label, angle —
// without going back to the closet. Mirrors the ConfirmDialog
// visual pattern so the styling stays consistent.
//
// "Promote to main" is a two-step flow because the previous main has
// to go somewhere; the second step asks whether to demote it to a
// label or an angle. The other re-classifications are single-PATCH:
// label↔angle is just /api/items/[id]/photos/[photoId] PATCH with
// the chosen kind.
export type SheetPhoto = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  /** Current role. "pending" rows come from the merge endpoint and
   *  haven't been triaged yet. */
  kind: "label" | "angle" | "pending";
};

export default function PhotoActionsSheet({
  itemId,
  photo,
  onClose,
}: {
  itemId: string;
  photo: SheetPhoto;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Two-step state: when "Make main" is tapped we swap the action list
  // for a follow-up "what about the old main?" picker. Cancelling the
  // picker bounces back to the action list instead of closing the
  // whole sheet.
  const [pickingDemote, setPickingDemote] = useState(false);

  const src = photo.imageBgRemovedPath
    ? `/api/uploads/${photo.imageBgRemovedPath}`
    : `/api/uploads/${photo.imagePath}`;

  async function setKind(nextKind: "label" | "angle") {
    if (busy || nextKind === photo.kind) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/items/${itemId}/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: nextKind }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body?.error ?? "Couldn't move that photo", "error");
        return;
      }
      haptic("selection");
      toast(nextKind === "label" ? "Moved to labels" : "Moved to angles");
      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  async function promoteToMain(demoteToKind: "label" | "angle") {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/items/${itemId}/photos/${photo.id}/set-main`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoteToKind }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body?.error ?? "Couldn't promote that photo", "error");
        return;
      }
      haptic("success");
      toast("Main photo updated");
      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this photo?",
      body: "The image file is removed from disk.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/items/${itemId}/photos/${photo.id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body?.error ?? "Couldn't delete photo", "error");
        return;
      }
      haptic("impact");
      toast("Photo removed");
      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-actions-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-sm sm:items-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tile-bg flex aspect-video items-center justify-center p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={photo.kind === "label" ? "Label photo" : "Angle photo"}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        <div className="px-5 pb-5 pt-4">
          <h2 id="photo-actions-title" className="font-display text-lg text-stone-800">
            {pickingDemote ? "What about the current main?" : "Photo actions"}
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            {pickingDemote
              ? "Pick where the old main should land. You can change it again from its tile."
              : photo.kind === "pending"
                ? "Pick a role for this photo, or make it the main."
                : photo.kind === "label"
                  ? "Currently a label / tag photo."
                  : "Currently an angle photo."}
          </p>

          {pickingDemote ? (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={busy}
                onClick={() => promoteToMain("angle")}
              >
                Old main → Angle
              </button>
              <button
                type="button"
                className="btn-secondary w-full"
                disabled={busy}
                onClick={() => promoteToMain("label")}
              >
                Old main → Label
              </button>
              <button
                type="button"
                className="btn-ghost w-full text-sm text-stone-500"
                disabled={busy}
                onClick={() => setPickingDemote(false)}
              >
                Back
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={busy}
                onClick={() => setPickingDemote(true)}
              >
                ★ Make this the main photo
              </button>
              {photo.kind !== "label" && (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={busy}
                  onClick={() => setKind("label")}
                >
                  🏷 Mark as label
                </button>
              )}
              {photo.kind !== "angle" && (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={busy}
                  onClick={() => setKind("angle")}
                >
                  📸 Mark as angle
                </button>
              )}
              <button
                type="button"
                className="btn-ghost w-full text-sm text-blush-700"
                disabled={busy}
                onClick={remove}
              >
                Delete photo
              </button>
              <button
                type="button"
                className="btn-ghost w-full text-sm text-stone-500"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
