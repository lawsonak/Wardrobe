"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type WishlistItem = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  link: string | null;
  price: string | null;
  imagePath: string | null;
  priority: string;
  occasion: string | null;
  notes: string | null;
  fillsGap: boolean;
  giftIdea: boolean;
  purchased: boolean;
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-blush-100 text-blush-700 ring-blush-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-stone-100 text-stone-500 ring-stone-200",
};

export default function WishlistCard({ item }: { item: WishlistItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function togglePurchased() {
    setBusy(true);
    haptic("tap");
    const next = !item.purchased;
    const res = await fetch(`/api/wishlist/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchased: next }),
    });
    setBusy(false);
    if (res.ok) {
      toast(next ? "Marked purchased" : "Back on your wishlist");
      router.refresh();
    } else {
      toast("Couldn't update wish", "error");
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Remove "${item.name}"?`,
      body: "You can always add it back later.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/wishlist/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast("Removed from wishlist");
      router.refresh();
    } else {
      toast("Couldn't remove wish", "error");
    }
  }

  const priorityClass = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.medium;

  return (
    <div className="card flex gap-3 p-3">
      {item.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/uploads/${item.imagePath}`}
          alt={item.name}
          className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-stone-100"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`font-medium leading-tight ${item.purchased ? "line-through text-stone-400" : "text-stone-800"}`}>
              {item.name}
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              {[item.brand, item.category, item.price ? `$${item.price}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${priorityClass}`}>
            {item.priority}
          </span>
        </div>

        {(item.occasion || item.notes) && (
          <p className="mt-1 text-xs text-stone-500 truncate">
            {item.occasion ? `For: ${item.occasion}` : item.notes}
          </p>
        )}

        <div className="mt-1 flex flex-wrap gap-1">
          {item.fillsGap && (
            <span className="chip chip-off text-[10px] px-2 py-0.5">fills a gap</span>
          )}
          {item.giftIdea && (
            <span className="chip chip-off text-[10px] px-2 py-0.5">gift idea</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={togglePurchased}
            disabled={busy}
            className="chip chip-off text-xs"
          >
            {item.purchased ? "↩ Unmark" : "✓ Purchased"}
          </button>
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="chip chip-off text-xs"
            >
              View →
            </a>
          )}
          <Link href={`/wishlist/${item.id}/edit`} className="chip chip-off text-xs">
            Edit
          </Link>
          <button onClick={remove} disabled={busy} className="text-xs text-stone-400 hover:text-blush-600 ml-auto">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
