"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type Outfit = {
  id: string;
  name: string;
  activity: string | null;
  season: string | null;
  isFavorite: boolean;
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
}: {
  outfit: Outfit;
  slotsOrder: string[];
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
    if (!confirm(`Delete "${outfit.name}"?`)) return;
    setBusy(true);
    await fetch(`/api/outfits/${outfit.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="card overflow-hidden">
      <div className="tile-bg grid grid-cols-3 gap-2 p-3">
        {sorted.slice(0, 6).map(({ item }) => {
          const src = item.imageBgRemovedPath
            ? `/api/uploads/${item.imageBgRemovedPath}`
            : `/api/uploads/${item.imagePath}`;
          return (
            <div key={item.id} className="flex aspect-square items-center justify-center rounded-xl bg-white/60 p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain" />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-stone-800">{outfit.name}</p>
          <p className="truncate text-xs text-stone-500">
            {[outfit.activity, outfit.season].filter(Boolean).join(" • ") || "—"}
          </p>
        </div>
        <div className="flex items-center gap-1">
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
          <button onClick={remove} className="btn-ghost text-stone-500 px-2" aria-label="Delete">×</button>
        </div>
      </div>
    </div>
  );
}
