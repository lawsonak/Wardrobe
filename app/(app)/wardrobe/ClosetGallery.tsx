"use client";

import { useState } from "react";
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
//   ✓ Mark needs-review    (PATCH each item.status — local loop)
//   Cancel / Done           (exits select mode without acting)
//
// Both bulk action endpoints are existing — same dispatch the bulk
// upload + needs-review buttons use. Server kicks off the work and
// fires a notification when done; the user can leave the page.
export default function ClosetGallery({ items }: { items: ItemCardItem[] }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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
    </>
  );
}
