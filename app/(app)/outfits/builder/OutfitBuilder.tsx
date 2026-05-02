"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ACTIVITIES,
  SEASONS,
  SLOTS,
  slotForItem,
  csvToList,
  type Slot,
} from "@/lib/constants";
import ItemCard from "@/components/ItemCard";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { itemMatchesActivity } from "@/lib/activities";

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

// Each slot can hold multiple items (e.g. layered tops, multiple
// accessories, or several pieces of jewelry).
type Picks = Record<Slot, BuilderItem[]>;

const SLOT_LABELS: Record<Slot, string> = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessory: "Accessories",
  bag: "Bag",
};

// Slots where multi-select is natural — layered tops, underwear +
// pants, multiple necklaces, a tote and a clutch, etc. Only `dress`
// stays single-pick (and is mutually exclusive with top/bottom).
const MULTI_SLOTS = new Set<Slot>([
  "top",
  "bottom",
  "outerwear",
  "accessory",
  "bag",
  "shoes",
]);

function emptyPicks(): Picks {
  return { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], bag: [] };
}

export type InitialOutfit = {
  id: string;
  name: string;
  activity: string | null;
  season: string | null;
  isFavorite: boolean;
  items: { itemId: string; slot: string }[];
};

export default function OutfitBuilder({
  items,
  initial,
}: {
  items: BuilderItem[];
  initial?: InitialOutfit;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const initialActivity = initial?.activity ?? search.get("activity") ?? "";
  const initialSeason = initial?.season ?? search.get("season") ?? "";
  const shouldAutoShuffle = !initial && search.get("shuffle") === "1";
  // Pre-pick item IDs from `?ids=a,b,c` (used by "Build me an outfit").
  const initialIdsParam = !initial ? search.get("ids") ?? "" : "";
  const initialName = !initial ? search.get("name") ?? "" : "";

  const [activity, setActivity] = useState<string>(initialActivity);
  const [season, setSeason] = useState<string>(initialSeason);
  const [favOnly, setFavOnly] = useState(false);
  const [picks, setPicks] = useState<Picks>(() => {
    const p = emptyPicks();
    const byId = new Map(items.map((i) => [i.id, i]));
    if (initial) {
      for (const oi of initial.items) {
        const it = byId.get(oi.itemId);
        const slot = (oi.slot as Slot) || (it && slotForItem(it.category, it.subType));
        if (it && slot && SLOTS.includes(slot)) p[slot].push(it);
      }
      return p;
    }
    if (initialIdsParam) {
      for (const id of initialIdsParam.split(",").filter(Boolean)) {
        const it = byId.get(id);
        if (!it) continue;
        const slot = slotForItem(it.category, it.subType);
        if (slot) p[slot].push(it);
      }
    }
    return p;
  });
  const [name, setName] = useState(initial?.name ?? initialName);
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const seasons = csvToList(it.seasons);
      // Activity filter pulls in inferred categories so e.g. "beach"
      // surfaces every Swimwear item even when no one tagged it.
      if (activity && !itemMatchesActivity(it, activity)) return false;
      if (season && seasons.length > 0 && !seasons.includes(season)) return false;
      if (favOnly && !it.isFavorite) return false;
      return true;
    });
  }, [items, activity, season, favOnly]);

  const itemsBySlot = useMemo(() => {
    const map: Picks = emptyPicks();
    for (const it of filtered) {
      const slot = slotForItem(it.category, it.subType);
      if (slot) map[slot].push(it);
    }
    return map;
  }, [filtered]);

  // If a dress is picked, hide top/bottom slots; if top/bottom picked, hide dress
  const showSlots: Slot[] = useMemo(() => {
    const all: Slot[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"];
    if (picks.dress.length > 0) return all.filter((s) => s !== "top" && s !== "bottom");
    if (picks.top.length > 0 || picks.bottom.length > 0) return all.filter((s) => s !== "dress");
    return all;
  }, [picks]);

  function isPicked(slot: Slot, id: string): boolean {
    return picks[slot].some((p) => p.id === id);
  }

  function togglePick(slot: Slot, item: BuilderItem) {
    haptic("selection");
    setPicks((prev) => {
      const next: Picks = { top: [...prev.top], bottom: [...prev.bottom], dress: [...prev.dress], outerwear: [...prev.outerwear], shoes: [...prev.shoes], accessory: [...prev.accessory], bag: [...prev.bag] };
      const list = next[slot];
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        if (MULTI_SLOTS.has(slot)) {
          list.push(item);
        } else {
          // Single-pick slots (just `dress`) replace on tap.
          next[slot] = [item];
        }
        if (slot === "dress") { next.top = []; next.bottom = []; }
        if (slot === "top" || slot === "bottom") { next.dress = []; }
      }
      return next;
    });
  }

  // Auto-shuffle once on mount if the URL says so. Runs exactly once.
  const didAutoShuffle = useRef(false);
  useEffect(() => {
    if (shouldAutoShuffle && !didAutoShuffle.current && items.length > 0) {
      didAutoShuffle.current = true;
      setTimeout(() => surprise(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoShuffle, items]);

  // Local random fallback used when AI is off / fails. Respects two
  // hard rules: never pair Underwear with anything, and never mix
  // Swimwear with non-swim items unless the activity is "beach".
  function localRandomSurprise() {
    const sample = (arr: BuilderItem[]) => arr[Math.floor(Math.random() * arr.length)];
    const isSwim = (it: BuilderItem) => it.category === "Swimwear";
    const isUndies = (it: BuilderItem) =>
      it.category === "Underwear" || it.category === "Bras";
    const swimMode = activity === "beach";
    const filterPool = (pool: BuilderItem[]) =>
      pool.filter((it) => {
        if (isUndies(it)) return false;
        if (isSwim(it) && !swimMode) return false;
        if (!isSwim(it) && swimMode) return false;
        return true;
      });

    const tops = filterPool(itemsBySlot.top);
    const bottoms = filterPool(itemsBySlot.bottom);
    const dresses = filterPool(itemsBySlot.dress);
    const shoes = filterPool(itemsBySlot.shoes);
    const outers = filterPool(itemsBySlot.outerwear);
    const accs = filterPool(itemsBySlot.accessory);
    const bags = filterPool(itemsBySlot.bag);

    const next: Picks = emptyPicks();
    if (dresses.length > 0 && Math.random() < 0.4) {
      next.dress = [sample(dresses)];
    } else {
      if (tops.length > 0) next.top = [sample(tops)];
      if (bottoms.length > 0 && !swimMode) next.bottom = [sample(bottoms)];
      else if (bottoms.length > 0 && swimMode && Math.random() < 0.7) next.bottom = [sample(bottoms)];
    }
    if (shoes.length > 0) next.shoes = [sample(shoes)];
    if (outers.length > 0 && Math.random() < 0.5) next.outerwear = [sample(outers)];
    if (accs.length > 0 && Math.random() < 0.4) next.accessory = [sample(accs)];
    if (bags.length > 0 && Math.random() < 0.4) next.bag = [sample(bags)];
    setPicks(next);
  }

  // AI-driven outfit pick. Calls /api/ai/outfit with the current
  // activity/season as occasion context; the server-side prompt
  // enforces compatibility rules (no underwear with swim, swim only
  // for beach, etc.) and folds in the user's free-form style notes
  // from settings. Falls back to localRandomSurprise on any failure.
  async function surprise() {
    haptic("tap");
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const occasion = [
        activity ? `activity: ${activity}` : "Casual outfit from my closet",
        season ? `season: ${season}` : "",
        favOnly ? "prefer favorites" : "",
      ].filter(Boolean).join(" · ");
      const res = await fetch("/api/ai/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occasion,
          season: season || undefined,
          activity: activity || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        toast("AI is off — picking randomly", "info");
        localRandomSurprise();
        return;
      }
      const ids = (data?.itemIds ?? []) as string[];
      if (ids.length === 0) {
        localRandomSurprise();
        return;
      }
      const byId = new Map(items.map((it) => [it.id, it]));
      const next: Picks = emptyPicks();
      for (const id of ids) {
        const it = byId.get(id);
        if (!it) continue;
        const slot = slotForItem(it.category, it.subType);
        if (slot) next[slot].push(it);
      }
      // Enforce mutual-exclusion in case the AI returned both a
      // dress and a top+bottom.
      if (next.dress.length > 0) { next.top = []; next.bottom = []; }
      setPicks(next);
      // Always replace the name with the AI's suggestion on each
      // Surprise-me run — the user explicitly asked for a fresh
      // pick, so a fresh AI-suggested name is the natural pair. They
      // can still type their own afterward and Save will use that.
      if (data.name) setName(data.name);
    } catch (err) {
      console.error("AI surprise failed", err);
      localRandomSurprise();
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const chosen: { slot: Slot; itemId: string }[] = [];
    for (const slot of SLOTS) {
      for (const it of picks[slot]) chosen.push({ slot, itemId: it.id });
    }
    if (chosen.length === 0) {
      setError("Pick at least one piece first.");
      return;
    }
    setError(null);
    setSaving(true);
    const url = initial ? `/api/outfits/${initial.id}` : "/api/outfits";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
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
    // Pull the outfit id back so we can kick off the AI fit pass for
    // newly-created outfits. We skip on edit so we don't overwrite a
    // user's manual drag-drop layout.
    let savedOutfitId: string | null = initial?.id ?? null;
    if (!initial) {
      try {
        const data = (await res.clone().json()) as { outfit?: { id?: string } };
        if (typeof data.outfit?.id === "string") savedOutfitId = data.outfit.id;
      } catch {
        /* ignore — fit pass just won't fire if we can't resolve the id */
      }
    }
    if (!initial && savedOutfitId) {
      // Fire-and-forget. The Style canvas opens with the calibrated
      // layout already saved by the time the user navigates there.
      fetch(`/api/outfits/${savedOutfitId}/fit`, { method: "POST" }).catch(() => null);
    }
    haptic("success");
    toast("Outfit saved");
    router.push("/outfits");
    router.refresh();
  }

  const flatPicks = SLOTS.flatMap((s) => picks[s].map((p) => ({ slot: s, item: p })));

  return (
    // Extra bottom padding so the sticky save bar (~10rem on mobile,
    // including the input row + button) doesn't permanently cover the
    // last few item tiles in the bottom slot. Without this you can't
    // scroll past the last picker row.
    <div className="space-y-5 pb-44 sm:pb-32">
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
          <button
            type="button"
            onClick={surprise}
            className="btn-primary ml-auto"
            disabled={saving}
          >
            {saving ? "Picking…" : "✨ Surprise me"}
          </button>
          <button type="button" onClick={() => setPicks(emptyPicks())} className="btn-ghost">Clear</button>
        </div>
      </div>

      {/* Preview */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl text-stone-800">Preview</h2>
          <p className="text-xs text-stone-500">{flatPicks.length} piece{flatPicks.length === 1 ? "" : "s"}</p>
        </div>
        {flatPicks.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-500">Nothing picked yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {flatPicks.map(({ slot, item }) => {
              const src = item.imageBgRemovedPath ? `/api/uploads/${item.imageBgRemovedPath}` : `/api/uploads/${item.imagePath}`;
              return (
                <div key={`${slot}-${item.id}`} className="tile-bg flex aspect-square items-center justify-center rounded-2xl p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={item.subType ?? slot} className="h-full w-full object-contain" />
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
        return (
          <section key={slot}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-display text-lg text-stone-800">{SLOT_LABELS[slot]}</h3>
              {MULTI_SLOTS.has(slot) && (
                <span className="text-[11px] text-stone-400">tap multiple</span>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {list.map((it) => {
                const on = isPicked(slot, it.id);
                return (
                  <div key={it.id} className={cn("w-28 shrink-0", on && "ring-blush-500")}>
                    <ItemCard
                      item={it}
                      selected={on}
                      onClick={() => togglePick(slot, it)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Save */}
      <div className="card sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 space-y-3 p-4 sm:bottom-4">
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
          {saving ? "Saving…" : initial ? "Save changes" : "Save outfit"}
        </button>
      </div>
    </div>
  );
}
