"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

// Small client widgets used by the read-only ItemDetailView. Each
// owns its own busy state and refreshes the page when done.

export function FavoriteToggle({
  itemId,
  initial,
}: {
  itemId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next);
    haptic("tap");
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setFav(!next);
      toast("Couldn't update favorite", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={fav ? "Unfavorite" : "Favorite"}
      className={cn(
        "btn-icon",
        fav ? "text-blush-600" : "text-stone-400 hover:text-blush-500",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 3.5 0 6 3.5 4 7.5C19 16.65 12 21 12 21z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function WoreTodayButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function press() {
    if (busy) return;
    setBusy(true);
    haptic("tap");
    try {
      const res = await fetch(`/api/items/${itemId}/wear`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast(data?.alreadyMarked ? "Already marked for today" : "Marked as worn today");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't update", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={press} disabled={busy} className="btn-secondary text-xs">
      👕 Wore today
    </button>
  );
}

export function DeleteItemButton({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function press() {
    const ok = await confirmDialog({
      title: `Delete ${label}?`,
      body: "It will be removed from your closet, outfits, and collections.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast("Item deleted");
      router.push("/wardrobe");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't delete", "error");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={press}
      disabled={busy}
      className="text-xs text-stone-400 hover:text-blush-700"
    >
      Delete this item
    </button>
  );
}
