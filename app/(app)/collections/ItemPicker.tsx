"use client";

import { useMemo, useState } from "react";
import { CATEGORIES, SEASONS, ACTIVITIES, csvToList } from "@/lib/constants";
import { cn } from "@/lib/cn";

export type Selectable = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
  isFavorite: boolean;
  seasons: string;
  activities: string;
};

// Filterable, toggleable grid of wardrobe items. Used by the wizard's
// "Add more pieces" step and by the edit-mode editor — same component,
// same affordances, same behaviour.
export default function ItemPicker({
  items,
  selected,
  onToggle,
  emptyHint = "No items match.",
}: {
  items: Selectable[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyHint?: string;
}) {
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSeason, setFilterSeason] = useState<string>("");
  const [filterActivity, setFilterActivity] = useState<string>("");
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filterCategory && it.category !== filterCategory) return false;
      if (favOnly && !it.isFavorite) return false;
      if (filterSeason) {
        const ss = csvToList(it.seasons);
        if (ss.length > 0 && !ss.includes(filterSeason)) return false;
      }
      if (filterActivity) {
        const aa = csvToList(it.activities);
        if (aa.length > 0 && !aa.includes(filterActivity)) return false;
      }
      if (q) {
        const blob = `${it.subType ?? ""} ${it.brand ?? ""} ${it.category}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [items, filterCategory, filterSeason, filterActivity, favOnly, search]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[10rem]"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select className="input w-auto" value={filterSeason} onChange={(e) => setFilterSeason(e.target.value)}>
          <option value="">Any season</option>
          {SEASONS.map((s) => (
            <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select className="input w-auto" value={filterActivity} onChange={(e) => setFilterActivity(e.target.value)}>
          <option value="">Any activity</option>
          {ACTIVITIES.map((a) => (
            <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
          ))}
        </select>
        <label className="chip chip-off cursor-pointer">
          <input type="checkbox" className="mr-1" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
          Favorites
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-stone-500">{emptyHint}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {filtered.map((it) => {
            const isOn = selected.has(it.id);
            const src = it.imageBgRemovedPath
              ? `/api/uploads/${it.imageBgRemovedPath}`
              : `/api/uploads/${it.imagePath}`;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onToggle(it.id)}
                  className={cn(
                    "tile-bg relative block aspect-square w-full overflow-hidden rounded-2xl ring-1 transition",
                    isOn ? "ring-2 ring-blush-500" : "ring-stone-100",
                  )}
                  aria-pressed={isOn}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={it.subType ?? it.category} className="h-full w-full object-contain p-2" />
                  {isOn && (
                    <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-blush-500 text-xs font-semibold text-white">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
