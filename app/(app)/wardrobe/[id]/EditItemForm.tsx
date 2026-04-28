"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIES,
  SEASONS,
  ACTIVITIES,
  ITEM_STATUSES,
  type Category,
  type ItemStatus,
} from "@/lib/constants";
import TagChips from "@/components/TagChips";
import ColorSwatch from "@/components/ColorSwatch";
import BrandInput from "@/components/BrandInput";
import FitDetailsEditor from "@/components/FitDetailsEditor";
import SubtypePicker from "@/components/SubtypePicker";
import { normalizeSize } from "@/lib/size";
import { parseFitDetails, serializeFitDetails } from "@/lib/fitDetails";

type Item = {
  id: string;
  category: string;
  subType: string | null;
  color: string | null;
  brand: string | null;
  brandId: string | null;
  size: string | null;
  notes: string | null;
  seasons: string[];
  activities: string[];
  isFavorite: boolean;
  status: string;
  fitDetails: string | null;
  fitNotes: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  needs_review: "Needs review",
  draft: "Draft",
};

export default function EditItemForm({ item }: { item: Item }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(item.category as Category);
  const [subType, setSubType] = useState(item.subType ?? "");
  const [color, setColor] = useState<string | null>(item.color);
  const [brand, setBrand] = useState(item.brand ?? "");
  const [brandId, setBrandId] = useState<string | null>(item.brandId);
  const [size, setSize] = useState(item.size ?? "");
  const [fitDetails, setFitDetails] = useState<Record<string, string>>(parseFitDetails(item.fitDetails));
  const [fitNotes, setFitNotes] = useState(item.fitNotes ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [seasons, setSeasons] = useState<string[]>(item.seasons);
  const [activities, setActivities] = useState<string[]>(item.activities);
  const [isFavorite, setIsFavorite] = useState(item.isFavorite);
  const [status, setStatus] = useState<ItemStatus>(item.status as ItemStatus);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    await fetch(`/api/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        subType,
        color: color ?? "",
        brand,
        brandId,
        size: normalizeSize(size, category),
        fitDetails: serializeFitDetails(fitDetails),
        fitNotes: fitNotes.trim(),
        notes,
        seasons,
        activities,
        isFavorite,
        status,
      }),
    });
    setBusy(false);
    setSaved(true);
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
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
      {item.status === "needs_review" && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
          This item needs review — fill in missing details and mark as active when ready.
        </div>
      )}

      <div>
        <label className="label">Category</label>
        <select className="input" value={category} onChange={(e) => { setCategory(e.target.value as Category); setSubType(""); }}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Type</label>
        <SubtypePicker category={category} value={subType} onChange={setSubType} />
      </div>

      <div>
        <label className="label">Color</label>
        <ColorSwatch value={color} onChange={setColor} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Brand</label>
          <BrandInput
            value={brand}
            brandId={brandId}
            onChange={({ value, brandId: id }) => {
              setBrand(value);
              setBrandId(id);
            }}
          />
        </div>
        <div>
          <label className="label">Size</label>
          <input
            className="input"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onBlur={() => setSize((s) => normalizeSize(s, category))}
            placeholder="e.g. M, 8"
          />
        </div>
      </div>

      <FitDetailsEditor
        category={category}
        values={fitDetails}
        onChange={setFitDetails}
        notes={fitNotes}
        onNotesChange={setFitNotes}
      />

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

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
          Favorite
        </label>

        <div>
          <label className="label text-right">Status</label>
          <select className="input w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={save} className="btn-primary flex-1" disabled={busy}>
          {saved ? "Saved!" : busy ? "Saving…" : "Save changes"}
        </button>
        <button onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}
