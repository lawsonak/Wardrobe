"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, SEASONS, ACTIVITIES, csvToList, type Category } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import type { ActivityTarget, TargetCounts } from "@/lib/capsulePlan";

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

export type CapsuleData = {
  id?: string;
  name: string;
  description: string | null;
  occasion: string | null;
  season: string | null;
  /** Date when the trip / event starts. ISO yyyy-mm-dd in the form. */
  dateNeeded: string | null;
  location: string | null;
  targetCounts: TargetCounts;
  activityTargets: ActivityTarget[];
  itemIds: string[];
};

export default function CapsuleEditor({
  capsule,
  items,
  mode,
  cancelHref = "/capsules",
  tripPlanInitiallyOpen = false,
}: {
  capsule: CapsuleData;
  items: Selectable[];
  mode: "create" | "edit";
  /** Where the Cancel link should navigate. Defaults to /capsules. */
  cancelHref?: string;
  /** Whether the Trip planning section starts expanded. The detail
   *  page passes `true` when the capsule already has any trip data. */
  tripPlanInitiallyOpen?: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState(capsule.name);
  const [description, setDescription] = useState(capsule.description ?? "");
  const [occasion, setOccasion] = useState(capsule.occasion ?? "");
  const [season, setSeason] = useState(capsule.season ?? "");
  const [dateNeeded, setDateNeeded] = useState(capsule.dateNeeded ?? "");
  const [location, setLocation] = useState(capsule.location ?? "");
  const [targetCounts, setTargetCounts] = useState<TargetCounts>(capsule.targetCounts);
  const [activityTargets, setActivityTargets] = useState<ActivityTarget[]>(capsule.activityTargets);
  // Trip planning is opt-in. Stays open whenever the capsule already
  // has trip data so users don't lose track of it on edit.
  const [tripOpen, setTripOpen] = useState(tripPlanInitiallyOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set(capsule.itemIds));

  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSeason, setFilterSeason] = useState<string>("");
  const [filterActivity, setFilterActivity] = useState<string>("");
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function toggle(id: string) {
    haptic("selection");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the collection a name first.");
      return;
    }
    setError(null);
    setBusy(true);
    const url = mode === "create" ? "/api/capsules" : `/api/capsules/${capsule.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          occasion,
          season,
          dateNeeded: dateNeeded || null,
          location: location.trim() || null,
          targetCounts,
          activityTargets,
          itemIds: [...selected],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as { capsule?: { id: string } };
      haptic("success");
      toast(mode === "create" ? "Collection created" : "Collection saved");
      router.push(d.capsule?.id ? `/capsules/${d.capsule.id}` : "/capsules");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't save the collection.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!capsule.id) return;
    const ok = await confirmDialog({
      title: `Delete "${capsule.name}"?`,
      body: "The pieces stay in your closet — only this collection is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/capsules/${capsule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast("Couldn't delete collection", "error");
      setBusy(false);
      return;
    }
    toast("Collection deleted");
    router.push("/capsules");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-3 p-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paris trip" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Occasion</label>
            <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="e.g. Vacation, Work week" />
          </div>
          <div>
            <label className="label">Season</label>
            <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">Any</option>
              {SEASONS.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Trip planning — collapsed by default. Toggling it on
          reveals date / location / pack list / outfit targets. */}
      <div className="card overflow-hidden">
        <button
          type="button"
          onClick={() => setTripOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          aria-expanded={tripOpen}
        >
          <div>
            <p className="font-display text-lg text-stone-800">Plan a trip</p>
            <p className="text-xs text-stone-500">
              Optional — date, weather, pack list, and AI-generated outfits.
            </p>
          </div>
          <span className="text-xs text-blush-600">
            {tripOpen ? "Hide" : "Add"}
          </span>
        </button>

        {tripOpen && (
          <div className="space-y-3 border-t border-stone-100 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Date needed</label>
                <input
                  type="date"
                  className="input"
                  value={dateNeeded}
                  onChange={(e) => setDateNeeded(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Location</label>
                <input
                  type="text"
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Paris, France"
                />
              </div>
            </div>

            <TargetCountsEditor counts={targetCounts} onChange={setTargetCounts} />
            <ActivityTargetsEditor targets={activityTargets} onChange={setActivityTargets} />
          </div>
        )}
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-stone-800">Pieces</h2>
          <span className="text-xs text-stone-500">{selected.size} selected</span>
        </div>
        <div className="card space-y-2 p-3">
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
            <p className="px-2 py-6 text-center text-sm text-stone-500">No items match.</p>
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
                      onClick={() => toggle(it.id)}
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
      </section>

      {error && <p className="text-sm text-blush-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} className="btn-primary flex-1" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create collection" : "Save changes"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
            Delete
          </button>
        )}
        <Link href={cancelHref} className="btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}

// Re-export type for callers that need to construct selectable items.
export type { Category };

// ── Target counts (pack list) ──────────────────────────────────
//
// "How many of each category should this capsule contain?" The UI
// only shows rows the user has actively added — empty pack list
// means a single "+ Add a category" picker. Stepper buttons (− / +)
// avoid keyboard-number-input churn on mobile.
function TargetCountsEditor({
  counts,
  onChange,
}: {
  counts: TargetCounts;
  onChange: (next: TargetCounts) => void;
}) {
  function setCount(category: string, n: number) {
    const next: TargetCounts = { ...counts };
    if (!Number.isFinite(n) || n <= 0) delete next[category];
    else next[category] = Math.min(50, Math.max(1, Math.floor(n)));
    onChange(next);
  }

  const populated = Object.entries(counts).filter(([, n]) => n > 0);
  const remaining = (CATEGORIES as readonly string[]).filter((c) => !(c in counts));

  return (
    <div>
      <p className="label mb-1">Pack list</p>
      <p className="mb-2 text-xs text-stone-500">
        How many pieces of each kind do you want to bring? Optional.
      </p>
      {populated.length === 0 ? (
        <p className="mb-2 text-xs text-stone-400">No pack list yet.</p>
      ) : (
        <ul className="space-y-1">
          {populated.map(([cat, n]) => (
            <li key={cat} className="flex items-center justify-between gap-2 rounded-lg bg-cream-50 px-3 py-1.5">
              <span className="text-sm text-stone-700">{cat}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCount(cat, n - 1)}
                  className="grid h-7 w-7 place-items-center rounded-full bg-white text-stone-500 ring-1 ring-stone-200 hover:text-blush-600"
                  aria-label={`Decrease ${cat}`}
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-medium tabular-nums text-stone-800">{n}</span>
                <button
                  type="button"
                  onClick={() => setCount(cat, n + 1)}
                  className="grid h-7 w-7 place-items-center rounded-full bg-white text-stone-500 ring-1 ring-stone-200 hover:text-blush-600"
                  aria-label={`Increase ${cat}`}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {remaining.length > 0 && (
        <select
          className="input mt-2 w-auto text-xs"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            setCount(e.target.value, 1);
          }}
        >
          <option value="">+ Add a category…</option>
          {remaining.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Activity targets ───────────────────────────────────────────
//
// "How many outfits do I need for each activity?" Drives the AI
// plan: it'll generate exactly that many distinct outfits per row,
// each tagged with the matching activity so they show up in the
// builder's activity filter.
function ActivityTargetsEditor({
  targets,
  onChange,
}: {
  targets: ActivityTarget[];
  onChange: (next: ActivityTarget[]) => void;
}) {
  function update(idx: number, patch: Partial<ActivityTarget>) {
    const next = targets.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(targets.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([
      ...targets,
      { activity: "casual", label: "Daytime outfits", count: 2 },
    ]);
  }

  return (
    <div>
      <p className="label mb-1">Outfit targets</p>
      <p className="mb-2 text-xs text-stone-500">
        e.g. 2 formal dinners, 3 business-casual lunches, 2 workouts. Each row
        becomes that many AI-picked outfits attached to this collection.
      </p>
      <ul className="space-y-2">
        {targets.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              className="input w-16 text-center"
              value={t.count}
              onChange={(e) => update(i, { count: Math.max(1, Number(e.target.value) || 1) })}
              aria-label="Count"
            />
            <input
              type="text"
              className="input flex-1 min-w-[8rem]"
              value={t.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label (e.g. Formal dinners)"
              maxLength={80}
              aria-label="Label"
            />
            <select
              className="input w-auto"
              value={t.activity}
              onChange={(e) => update(i, { activity: e.target.value })}
              aria-label="Activity"
            >
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>
                  {a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => remove(i)}
              className="btn-ghost text-xs text-stone-400 hover:text-blush-600"
              aria-label="Remove row"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={add} className="btn-secondary mt-2 text-xs">
        + Add an outfit target
      </button>
    </div>
  );
}
