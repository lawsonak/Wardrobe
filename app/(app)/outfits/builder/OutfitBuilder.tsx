"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACTIVITIES,
  SEASONS,
  SLOTS,
  CATEGORY_TO_SLOT,
  csvToList,
  type Slot,
  type Category,
} from "@/lib/constants";
import ItemCard from "@/components/ItemCard";
import { cn } from "@/lib/cn";

type BuilderItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
  isFavorite: boolean;
  seasons: string;
  activities: string;
};

type Picks = Partial<Record<Slot, BuilderItem>>;

const SLOT_LABELS: Record<Slot, string> = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessory: "Accessory",
  bag: "Bag",
};

export default function OutfitBuilder({ items }: { items: BuilderItem[] }) {
  const router = useRouter();
  const [activity, setActivity] = useState<string>("");
  const [season, setSeason] = useState<string>("");
  const [favOnly, setFavOnly] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [name, setName] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const seasons = csvToList(it.seasons);
      const acts = csvToList(it.activities);
      if (activity && acts.length > 0 && !acts.includes(activity)) return false;
      if (season && seasons.length > 0 && !seasons.includes(season)) return false;
      if (favOnly && !it.isFavorite) return false;
      return true;
    });
  }, [items, activity, season, favOnly]);

  const itemsBySlot = useMemo(() => {
    const map: Record<Slot, BuilderItem[]> = {
      top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], bag: [],
    };
    for (const it of filtered) {
      const slot = CATEGORY_TO_SLOT[it.category as Category];
      if (slot) map[slot].push(it);
    }
    return map;
  }, [filtered]);

  // If a dress is picked, hide top/bottom slots; if top/bottom picked, hide dress
  const showSlots: Slot[] = useMemo(() => {
    const all: Slot[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"];
    if (picks.dress) return all.filter((s) => s !== "top" && s !== "bottom");
    if (picks.top || picks.bottom) return all.filter((s) => s !== "dress");
    return all;
  }, [picks]);

  function pick(slot: Slot, item: BuilderItem) {
    setPicks((p) => {
      const next = { ...p };
      if (next[slot]?.id === item.id) {
        delete next[slot];
      } else {
        next[slot] = item;
        if (slot === "dress") { delete next.top; delete next.bottom; }
        if (slot === "top" || slot === "bottom") { delete next.dress; }
      }
      return next;
    });
  }

  function surprise() {
    const sample = (arr: BuilderItem[]) => arr[Math.floor(Math.random() * arr.length)];
    const next: Picks = {};
    if (itemsBySlot.dress.length > 0 && Math.random() < 0.4) {
      next.dress = sample(itemsBySlot.dress);
    } else {
      if (itemsBySlot.top.length > 0) next.top = sample(itemsBySlot.top);
      if (itemsBySlot.bottom.length > 0) next.bottom = sample(itemsBySlot.bottom);
    }
    if (itemsBySlot.shoes.length > 0) next.shoes = sample(itemsBySlot.shoes);
    if (itemsBySlot.outerwear.length > 0 && Math.random() < 0.5) next.outerwear = sample(itemsBySlot.outerwear);
    if (itemsBySlot.accessory.length > 0 && Math.random() < 0.4) next.accessory = sample(itemsBySlot.accessory);
    if (itemsBySlot.bag.length > 0 && Math.random() < 0.4) next.bag = sample(itemsBySlot.bag);
    setPicks(next);
  }

  async function save() {
    const chosen = Object.entries(picks)
      .filter(([, it]) => it)
      .map(([slot, it]) => ({ slot, itemId: (it as BuilderItem).id }));
    if (chosen.length === 0) {
      setError("Pick at least one piece first.");
      return;
    }
    setError(null);
    setSaving(true);
    const res = await fetch("/api/outfits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || "Untitled outfit",
        activity: activity || null,
        season: season || null,
        isFavorite,
        items: chosen,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Couldn't save that outfit.");
      return;
    }
    router.push("/outfits");
    router.refresh();
  }

  const sortedPicks = SLOTS.filter((s) => picks[s]);

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Activity</label>
            <select className="input w-auto" value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="">Any</option>
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Season</label>
            <select className="input w-auto" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">Any</option>
              {SEASONS.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <label className="chip chip-off cursor-pointer">
            <input type="checkbox" className="mr-1" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
            Favorites only
          </label>
          <button type="button" onClick={surprise} className="btn-primary ml-auto">✨ Surprise me</button>
          <button type="button" onClick={() => setPicks({})} className="btn-ghost">Clear</button>
        </div>
      </div>

      {/* Preview */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl text-stone-800">Preview</h2>
          <p className="text-xs text-stone-500">{sortedPicks.length} piece{sortedPicks.length === 1 ? "" : "s"}</p>
        </div>
        {sortedPicks.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-500">Nothing picked yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {sortedPicks.map((s) => {
              const it = picks[s]!;
              const src = it.imageBgRemovedPath ? `/api/uploads/${it.imageBgRemovedPath}` : `/api/uploads/${it.imagePath}`;
              return (
                <div key={s} className="tile-bg flex aspect-square items-center justify-center rounded-2xl p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={SLOT_LABELS[s]} className="h-full w-full object-contain" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slot pickers */}
      {showSlots.map((slot) => {
        const list = itemsBySlot[slot];
        if (list.length === 0) return null;
        const selected = picks[slot]?.id;
        return (
          <section key={slot}>
            <h3 className="mb-2 font-display text-lg text-stone-800">{SLOT_LABELS[slot]}</h3>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {list.map((it) => (
                <div key={it.id} className={cn("w-28 shrink-0", selected === it.id && "ring-blush-500")}>
                  <ItemCard
                    item={it}
                    selected={selected === it.id}
                    onClick={() => pick(slot, it)}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Save */}
      <div className="card sticky bottom-20 z-10 space-y-3 p-4 sm:bottom-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[14rem]"
            placeholder="Name this outfit (e.g. Sunday brunch)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="chip chip-off cursor-pointer">
            <input type="checkbox" className="mr-1" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
            Favorite
          </label>
        </div>
        {error && <p className="text-sm text-blush-700">{error}</p>}
        <button type="button" onClick={save} className="btn-primary w-full" disabled={saving}>
          {saving ? "Saving…" : "Save outfit"}
        </button>
      </div>
    </div>
  );
}
