"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIES,
  SUBTYPES_BY_CATEGORY,
  SEASONS,
  ACTIVITIES,
  type Category,
} from "@/lib/constants";
import TagChips from "@/components/TagChips";
import ColorSwatch from "@/components/ColorSwatch";

type Item = {
  id: string;
  category: string;
  subType: string | null;
  color: string | null;
  brand: string | null;
  size: string | null;
  notes: string | null;
  seasons: string[];
  activities: string[];
  isFavorite: boolean;
};

export default function EditItemForm({ item }: { item: Item }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(item.category as Category);
  const [subType, setSubType] = useState(item.subType ?? "");
  const [color, setColor] = useState<string | null>(item.color);
  const [brand, setBrand] = useState(item.brand ?? "");
  const [size, setSize] = useState(item.size ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [seasons, setSeasons] = useState<string[]>(item.seasons);
  const [activities, setActivities] = useState<string[]>(item.activities);
  const [isFavorite, setIsFavorite] = useState(item.isFavorite);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        subType,
        color: color ?? "",
        brand,
        size,
        notes,
        seasons,
        activities,
        isFavorite,
      }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this item from your closet?")) return;
    setBusy(true);
    await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    router.push("/wardrobe");
    router.refresh();
  }

  return (
    <div className="card space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <input
            className="input"
            list="subtype-suggestions-edit"
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
          />
          <datalist id="subtype-suggestions-edit">
            {SUBTYPES_BY_CATEGORY[category]?.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      <div>
        <label className="label">Color</label>
        <ColorSwatch value={color} onChange={setColor} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Brand</label>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div>
          <label className="label">Size</label>
          <input className="input" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Seasons</label>
        <TagChips options={SEASONS} values={seasons} onChange={setSeasons} format={(v) => v[0].toUpperCase() + v.slice(1)} />
      </div>

      <div>
        <label className="label">Activities</label>
        <TagChips options={ACTIVITIES} values={activities} onChange={setActivities} format={(v) => v[0].toUpperCase() + v.slice(1)} />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
        Favorite
      </label>

      <div className="flex gap-2 pt-2">
        <button onClick={save} className="btn-primary flex-1" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}
