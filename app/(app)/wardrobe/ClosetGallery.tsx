"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ItemCard, { type ItemCardItem } from "@/components/ItemCard";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

// Closet gallery with optional multi-select for bulk actions.
//
// Default mode: tap a tile to open its detail page (the normal closet
// flow, unchanged).
//
// Select mode: an "✓ Select" pill toggles in. While on, every tile's
// onClick toggles its membership in the selected set instead of
// navigating. A sticky action bar appears at the bottom with:
//   ✨ Re-run AI tagging (POST /api/ai/tag-bulk { itemIds })
//   ✂️ Remove backgrounds  (POST /api/items/bg-remove-batch { itemIds })
//   Cancel / Done           (exits select mode without acting)
//
// Both bulk action endpoints are existing — same dispatch the bulk
// upload buttons use. Server kicks off the work and
// fires a notification when done; the user can leave the page.
export default function ClosetGallery({ items }: { items: ItemCardItem[] }) {
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // When set, render the "pick the keeper" sheet for merge. Holds the
  // ids of the items currently selected so the picker keeps showing
  // them even if the user later un-checks one in the gallery.
  const [mergePickerIds, setMergePickerIds] = useState<string[] | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelected(new Set());
    setSelectMode(false);
  }

  async function selectAll() {
    setSelected(new Set(items.map((it) => it.id)));
  }

  async function bulkRetag() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: `Re-run AI tagging on ${ids.length} item${ids.length === 1 ? "" : "s"}?`,
      body: "The AI rewrites empty fields and updates suggestions; existing values you've set stick.",
      confirmText: "Run",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ai/tag-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ids, background: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        toast(data.message ?? "AI tagging is disabled", "error");
        return;
      }
      if (!res.ok) {
        toast(data?.error ?? "Couldn't start AI tagging", "error");
        return;
      }
      toast(`AI tagging ${data.count ?? ids.length} item${(data.count ?? ids.length) === 1 ? "" : "s"} on the server`);
      exitSelect();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  // Merge: the user picks a "keeper" target from the selection in the
  // picker sheet, then we POST to /api/items/[target]/merge with the
  // rest as sourceIds. Source items get folded onto the target (their
  // main photo becomes a new ItemPhoto on the target) and are then
  // deleted, so we router.refresh() after success so the closet
  // gallery drops the now-gone source rows.
  async function runMerge(targetId: string) {
    const sourceIds = (mergePickerIds ?? []).filter((id) => id !== targetId);
    if (sourceIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${targetId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't merge items", "error");
        return;
      }
      toast(
        `Merged ${sourceIds.length} item${sourceIds.length === 1 ? "" : "s"} — review the new photos on the kept item.`,
      );
      setMergePickerIds(null);
      exitSelect();
      // Source rows are gone from the DB; refresh the server component
      // so the closet drops them and the navigated user picks up the
      // target item's new photo set.
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  async function bulkBgRemove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: `Remove backgrounds from ${ids.length} item${ids.length === 1 ? "" : "s"}?`,
      body: "Runs on the server. You'll get a notification when it's done — feel free to close the tab.",
      confirmText: "Run it",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/items/bg-remove-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ids, background: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't start background removal", "error");
        return;
      }
      toast(`Cutting backgrounds for ${data.count ?? ids.length} item${(data.count ?? ids.length) === 1 ? "" : "s"} on the server`);
      exitSelect();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            if (selectMode) exitSelect();
            else setSelectMode(true);
          }}
          className={"chip " + (selectMode ? "chip-on" : "chip-off")}
        >
          {selectMode ? `✓ ${selected.size} selected` : "Select multiple"}
        </button>
        {selectMode && (
          <>
            <button
              type="button"
              onClick={selectAll}
              className="text-stone-500 hover:text-blush-600"
            >
              Select all ({items.length})
            </button>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-stone-500 hover:text-blush-600"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            // In select mode, tap toggles membership instead of opening
            // the detail page; in normal mode the existing href is used.
            href={selectMode ? undefined : `/wardrobe/${item.id}`}
            onClick={selectMode ? () => toggle(item.id) : undefined}
            selected={selectMode && selected.has(item.id)}
            compact
          />
        ))}
      </div>

      {selectMode && selected.size > 0 && (
        <div
          // Sticky above the mobile bottom nav. Same offset pattern as
          // the OutfitBuilder save bar so it doesn't sit ON the nav.
          className={cn(
            "card sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 p-3 sm:bottom-4",
          )}
        >
          <p className="text-xs text-stone-500">
            {selected.size} item{selected.size === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={bulkRetag}
              disabled={busy}
              className="btn-secondary text-sm"
            >
              ✨ Re-run AI tagging
            </button>
            <button
              type="button"
              onClick={bulkBgRemove}
              disabled={busy}
              className="btn-secondary text-sm"
            >
              ✂️ Remove backgrounds
            </button>
            {/* Merge needs at least 2 selected (one becomes the keeper,
                the rest fold in). Hidden below that threshold so the
                action bar isn't littered with disabled buttons. */}
            {selected.size >= 2 && (
              <button
                type="button"
                onClick={() => setMergePickerIds([...selected])}
                disabled={busy}
                className="btn-secondary text-sm"
              >
                ⤵ Merge
              </button>
            )}
            <button
              type="button"
              onClick={exitSelect}
              disabled={busy}
              className="btn-ghost ml-auto text-stone-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Merge picker — small modal that asks "which one should we keep?"
          The picked tile becomes the merge target; the rest are sources
          and get folded into it. Inline rendering (no portal) keeps the
          surface area small and avoids pulling in a modal lib. */}
      {mergePickerIds && (
        <div
          // Backdrop click closes the sheet without merging.
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setMergePickerIds(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card max-h-[80vh] w-full max-w-md overflow-y-auto p-4"
          >
            <h2 className="font-display text-lg text-stone-800">Pick the keeper</h2>
            <p className="mt-1 text-sm text-stone-600">
              The one you tap stays put. The other {mergePickerIds.length - 1} get
              folded in — their photos become extra angles / labels on the
              keeper, and the source items are removed.
            </p>
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {mergePickerIds
                .map((id) => items.find((it) => it.id === id))
                .filter((it): it is ItemCardItem => !!it)
                .map((it) => {
                  const src = it.imageBgRemovedPath
                    ? `/api/uploads/${it.imageBgRemovedPath}`
                    : `/api/uploads/${it.imagePath}`;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => runMerge(it.id)}
                        disabled={busy}
                        className="group relative block w-full overflow-hidden rounded-xl ring-1 ring-stone-200 hover:ring-blush-400 disabled:opacity-50"
                      >
                        <div className="tile-bg flex aspect-square items-center justify-center p-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="px-2 py-1 text-left text-xs text-stone-600">
                          <p className="truncate">{it.subType ?? it.category}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setMergePickerIds(null)}
                disabled={busy}
                className="btn-ghost text-stone-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
