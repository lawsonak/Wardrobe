"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import OutfitMiniCanvas from "@/components/OutfitMiniCanvas";

type Outfit = {
  id: string;
  name: string;
  activity: string | null;
  season: string | null;
  isFavorite: boolean;
  layoutJson: string | null;
  items: Array<{
    slot: string;
    item: {
      id: string;
      imagePath: string;
      imageBgRemovedPath: string | null;
      category: string;
      subType: string | null;
    };
  }>;
};

export default function OutfitCard({
  outfit,
  slotsOrder,
  mannequinSrc,
  renderedSrc,
}: {
  outfit: Outfit;
  slotsOrder: string[];
  mannequinSrc?: string | null;
  renderedSrc?: string | null;
}) {
  const router = useRouter();
  const [fav, setFav] = useState(outfit.isFavorite);
  const [busy, setBusy] = useState(false);

  const sorted = [...outfit.items].sort(
    (a, b) => slotsOrder.indexOf(a.slot) - slotsOrder.indexOf(b.slot),
  );

  async function toggleFav() {
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next);
    await fetch(`/api/outfits/${outfit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: next }),
    });
    setBusy(false);
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete "${outfit.name}"?`,
      body: "The pieces in your closet stay — only this saved outfit is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/outfits/${outfit.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast("Outfit deleted");
      router.refresh();
    } else {
      toast("Couldn't delete outfit", "error");
    }
  }

  const items = sorted.map((s) => s.item);

  return (
    <div className="card overflow-hidden">
      <Link
        href={`/outfits/${outfit.id}/style`}
        aria-label={`Open style canvas for ${outfit.name}`}
        className="block tile-bg transition hover:opacity-95"
      >
        <OutfitMiniCanvas
          items={items}
          layoutJson={outfit.layoutJson}
          mannequinSrc={mannequinSrc}
          renderedSrc={renderedSrc}
          className="mx-auto max-h-[60vh] w-full"
        />
      </Link>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-stone-800">{outfit.name}</p>
          <p className="truncate text-xs text-stone-500">
            {[outfit.activity, outfit.season].filter(Boolean).join(" • ") || "—"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/outfits/${outfit.id}/edit`}
            className="btn-ghost px-2 text-xs text-stone-600"
            aria-label="Edit outfit"
            title="Edit"
          >
            Edit
          </Link>
          <Link
            href={`/outfits/${outfit.id}/style`}
            className="btn-ghost px-2 text-xs text-stone-500"
            aria-label="Open style canvas"
            title="Style canvas"
          >
            ✨ Style
          </Link>
          <button
            type="button"
            onClick={toggleFav}
            aria-label={fav ? "Unfavorite" : "Favorite"}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full",
              fav ? "text-blush-600" : "text-stone-400 hover:text-blush-500",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 3.5 0 6 3.5 4 7.5C19 16.65 12 21 12 21z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="btn-icon text-stone-400 hover:text-blush-600"
            aria-label={`Delete outfit "${outfit.name}"`}
            title="Delete outfit"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
