"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";

export type ItemCardItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
  isFavorite: boolean;
};

export default function ItemCard({
  item,
  href,
  onToggleFavorite,
  selected,
  onClick,
  size = "md",
}: {
  item: ItemCardItem;
  href?: string;
  onToggleFavorite?: (next: boolean) => void;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const [fav, setFav] = useState(item.isFavorite);
  const [busy, setBusy] = useState(false);

  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;

  const sizeCls =
    size === "sm" ? "aspect-square w-24" : size === "lg" ? "aspect-square w-full" : "aspect-square w-full";

  async function toggleFav(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next);
    try {
      await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      onToggleFavorite?.(next);
    } catch {
      setFav(!next);
    } finally {
      setBusy(false);
    }
  }

  const inner = (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl tile-bg ring-1 ring-stone-100 transition",
        selected && "ring-2 ring-blush-500",
      )}
    >
      <div className={cn(sizeCls, "flex items-center justify-center p-3")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={item.subType || item.category}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
      <button
        type="button"
        onClick={toggleFav}
        aria-label={fav ? "Unfavorite" : "Favorite"}
        className={cn(
          "absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/80 backdrop-blur transition",
          fav ? "text-blush-600" : "text-stone-400 hover:text-blush-500",
        )}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 3.5 0 6 3.5 4 7.5C19 16.65 12 21 12 21z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {item.subType && (
        <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/30 to-transparent px-3 py-2 text-xs font-medium text-white">
          {item.subType}
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {inner}
    </button>
  );
}
