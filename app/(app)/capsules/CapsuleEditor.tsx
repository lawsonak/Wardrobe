"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, SEASONS, ACTIVITIES, csvToList, type Category } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

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
  itemIds: string[];
};

export default function CapsuleEditor({
  capsule,
  items,
  mode,
}: {
  capsule: CapsuleData;
  items: Selectable[];
  mode: "create" | "edit";
}) {
  const router = useRouter();

  const [name, setName] = useState(capsule.name);
  const [description, setDescription] = useState(capsule.description ?? "");
  const [occasion, setOccasion] = useState(capsule.occasion ?? "");
  const [season, setSeason] = useState(capsule.season ?? "");
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
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the capsule a name first.");
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
          itemIds: [...selected],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as { capsule?: { id: string } };
      toast(mode === "create" ? "Capsule created" : "Capsule saved");
      router.push(d.capsule?.id ? `/capsules/${d.capsule.id}` : "/capsules");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't save the capsule.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!capsule.id) return;
    const ok = await confirmDialog({
      title: `Delete "${capsule.name}"?`,
      body: "The pieces stay in your closet — only this capsule is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/capsules/${capsule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast("Couldn't delete capsule", "error");
      setBusy(false);
      return;
    }
    toast("Capsule deleted");
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
          {busy ? "Saving…" : mode === "create" ? "Create capsule" : "Save changes"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
            Delete
          </button>
        )}
        <Link href="/capsules" className="btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}

// Re-export type for callers that need to construct selectable items.
export type { Category };
