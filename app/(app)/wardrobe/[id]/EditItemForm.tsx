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
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type Item = {
  id: string;
  imagePath: string;
  labelImagePath: string | null;
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
  const [autoTagState, setAutoTagState] = useState<"idle" | "running" | "done" | "disabled" | "error">("idle");
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);
  const [notesState, setNotesState] = useState<"idle" | "running" | "error">("idle");
  const [notesError, setNotesError] = useState<string | null>(null);

  async function generateNotes() {
    if (notesState === "running") return;
    setNotesState("running");
    setNotesError(null);
    try {
      // Pull the saved photos off the server. Fast for the user — they
      // already exist on disk.
      const r = await fetch(`/api/uploads/${item.imagePath}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading photo`);
      const blob = await r.blob();
      const fd = new FormData();
      fd.append("image", new File([blob], "item.jpg", { type: blob.type || "image/jpeg" }));
      if (item.labelImagePath) {
        try {
          const lr = await fetch(`/api/uploads/${item.labelImagePath}`);
          if (lr.ok) {
            const lblob = await lr.blob();
            fd.append("labelImage", new File([lblob], "label.jpg", { type: lblob.type || "image/jpeg" }));
          }
        } catch {
          /* best-effort */
        }
      }
      fd.append(
        "context",
        JSON.stringify({
          category,
          subType: subType || undefined,
          color: color || undefined,
          brand: brand || undefined,
          size: size || undefined,
          seasons,
          activities,
          existingNotes: notes || undefined,
        }),
      );
      const res = await fetch("/api/ai/notes", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setNotesError(data.message ?? "AI is disabled.");
        setNotesState("error");
        return;
      }
      const generated = String(data?.notes ?? "").trim();
      if (!generated) {
        setNotesError(data?.debug?.error ?? "Couldn't generate notes.");
        setNotesState("error");
        return;
      }
      setNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${generated}` : generated));
      setNotesState("idle");
    } catch (err) {
      console.error(err);
      setNotesError(err instanceof Error ? err.message : "Notes failed.");
      setNotesState("error");
    }
  }

  async function autoTag() {
    if (autoTagState === "running") return;
    setAutoTagState("running");
    setAutoTagMessage(null);
    try {
      const r = await fetch(`/api/uploads/${item.imagePath}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading photo`);
      const blob = await r.blob();
      const fd = new FormData();
      fd.append("image", new File([blob], "item.jpg", { type: blob.type || "image/jpeg" }));
      // If we already have a label photo on file, send it too — Pro can
      // OCR the brand / size / material / care text from the tag.
      if (item.labelImagePath) {
        try {
          const lr = await fetch(`/api/uploads/${item.labelImagePath}`);
          if (lr.ok) {
            const lblob = await lr.blob();
            fd.append("labelImage", new File([lblob], "label.jpg", { type: lblob.type || "image/jpeg" }));
          }
        } catch {
          /* best-effort */
        }
      }
      const res = await fetch("/api/ai/tag", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setAutoTagState("disabled");
        setAutoTagMessage(data.message ?? "AI tagging disabled.");
        return;
      }
      const s = (data?.suggestions ?? {}) as {
        category?: Category;
        subType?: string;
        color?: string;
        brand?: string;
        size?: string;
        seasons?: string[];
        activities?: string[];
        material?: string;
        careNotes?: string;
        notes?: string;
      };
      const debug = data?.debug as { error?: string; status?: number; rawText?: string } | undefined;
      const usedLabel = data?.hasLabel === true;
      let applied = 0;
      if (s.category && CATEGORIES.includes(s.category) && s.category !== category) {
        setCategory(s.category);
        applied++;
      }
      if (s.subType && !subType) { setSubType(s.subType); applied++; }
      if (s.color && !color) { setColor(s.color); applied++; }
      if (s.brand && !brand) { setBrand(s.brand); setBrandId(null); applied++; }
      if (s.size && !size) { setSize(s.size); applied++; }
      if (s.seasons && seasons.length === 0) {
        const valid = s.seasons.filter((x) => SEASONS.includes(x as never));
        if (valid.length > 0) { setSeasons(valid); applied++; }
      }
      if (s.activities && activities.length === 0) {
        const valid = s.activities.filter((x) => ACTIVITIES.includes(x as never));
        if (valid.length > 0) { setActivities(valid); applied++; }
      }
      const extras: string[] = [];
      if (s.material) extras.push(`Material: ${s.material}`);
      if (s.careNotes) extras.push(`Care: ${s.careNotes}`);
      if (s.notes) extras.push(s.notes);
      if (extras.length > 0 && !notes) {
        setNotes(extras.join("\n"));
        applied++;
      }
      if (s.material && !fitNotes) {
        setFitNotes(`Material: ${s.material}`);
      }

      if (applied > 0) {
        setAutoTagState("done");
        setAutoTagMessage(
          `Pre-filled ${applied} field${applied === 1 ? "" : "s"}${usedLabel ? " (read brand/size/care from label)" : ""} — review and save.`,
        );
      } else if (debug?.error) {
        setAutoTagState("error");
        setAutoTagMessage(debug.error);
      } else if (Object.keys(s).length === 0 && debug?.rawText) {
        setAutoTagState("error");
        setAutoTagMessage(`Model returned: ${debug.rawText.slice(0, 200)}`);
      } else {
        setAutoTagState("done");
        setAutoTagMessage("No new suggestions — fields already filled or model couldn't tell.");
      }
    } catch (err) {
      console.error(err);
      setAutoTagState("error");
      setAutoTagMessage(err instanceof Error ? err.message : "Auto-tag failed.");
    }
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    const res = await fetch(`/api/items/${item.id}`, {
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
    if (!res.ok) {
      toast("Couldn't save changes", "error");
      return;
    }
    setSaved(true);
    haptic("success");
    toast("Changes saved");
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  async function markWorn() {
    setBusy(true);
    haptic("tap");
    const res = await fetch(`/api/items/${item.id}/wear`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      toast("Marked as worn today");
      router.refresh();
    } else {
      toast("Couldn't update", "error");
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this item?",
      body: "It will be removed from your closet, outfits, and collections.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      toast("Couldn't delete", "error");
      return;
    }
    toast("Item deleted");
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
        <div className="mb-1 flex items-center justify-between">
          <label className="label !mb-0">Notes</label>
          <button
            type="button"
            onClick={generateNotes}
            disabled={notesState === "running"}
            className="text-xs text-blush-600 hover:underline disabled:cursor-not-allowed disabled:text-stone-400"
            title="Generate styling notes from the photo"
          >
            {notesState === "running" ? "Writing…" : "✨ Generate"}
          </button>
        </div>
        <textarea className="input min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {notesError && <p className="mt-1 text-xs text-blush-700">{notesError}</p>}
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

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
        <button
          type="button"
          onClick={autoTag}
          className="btn-ghost text-xs text-blush-600"
          disabled={busy || autoTagState === "running"}
          title="Ask AI to fill in any empty fields based on the photo"
        >
          {autoTagState === "running" ? "Reading photo…" : "✨ Auto-tag"}
        </button>
        {autoTagMessage && (
          <span className={"text-xs " + (autoTagState === "error" ? "text-blush-700" : "text-stone-500")}>
            {autoTagMessage}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={save} className="btn-primary flex-1" disabled={busy}>
          {saved ? "Saved!" : busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={markWorn}
          className="btn-secondary"
          disabled={busy}
          title="Bumps last-worn so dormant nudges leave it alone"
        >
          👕 Wore today
        </button>
        <button onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}
