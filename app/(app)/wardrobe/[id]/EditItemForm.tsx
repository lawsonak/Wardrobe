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
import { fetchWithRetry, friendlyFetchError } from "@/lib/fetchRetry";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";

type Item = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
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
  const autoTagProgress = useTimedProgress(autoTagState === "running", 18);
  const [lookupState, setLookupState] = useState<"idle" | "running" | "done" | "disabled" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [lookupSources, setLookupSources] = useState<string[]>([]);
  const lookupProgress = useTimedProgress(lookupState === "running", 12);

  // Load the item's main photo (preferring the smaller bg-removed
  // cutout) and the label photo if present. Uses fetchWithRetry so a
  // dropped fetch on flaky LTE / iOS Safari gets one automatic retry
  // instead of surfacing as an opaque "Load failed" error.
  async function loadPhotos(): Promise<{ image: File; label: File | null }> {
    const mainPath = item.imageBgRemovedPath ?? item.imagePath;
    const r = await fetchWithRetry(`/api/uploads/${mainPath}`);
    if (!r.ok) throw new Error(`Couldn't load photo (HTTP ${r.status}).`);
    const blob = await r.blob();
    const image = new File([blob], "item.jpg", { type: blob.type || "image/jpeg" });

    let label: File | null = null;
    if (item.labelImagePath) {
      try {
        const lr = await fetchWithRetry(`/api/uploads/${item.labelImagePath}`);
        if (lr.ok) {
          const lblob = await lr.blob();
          label = new File([lblob], "label.jpg", { type: lblob.type || "image/jpeg" });
        }
      } catch {
        /* best-effort — the model can still do its thing without the label */
      }
    }
    return { image, label };
  }

  // Single AI button — runs the tag + notes calls in parallel and
  // applies whichever results come back. One round-trip from the
  // user's perspective.
  async function autoTag() {
    if (autoTagState === "running") return;
    setAutoTagState("running");
    setAutoTagMessage(null);
    try {
      const photos = await loadPhotos();

      const tagFd = new FormData();
      tagFd.append("image", photos.image);
      if (photos.label) tagFd.append("labelImage", photos.label);

      const notesFd = new FormData();
      notesFd.append("image", photos.image);
      if (photos.label) notesFd.append("labelImage", photos.label);
      notesFd.append(
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

      const [tagSettled, notesSettled] = await Promise.allSettled([
        fetchWithRetry("/api/ai/tag", { method: "POST", body: tagFd }, { timeoutMs: 60_000 }),
        fetchWithRetry("/api/ai/notes", { method: "POST", body: notesFd }, { timeoutMs: 60_000 }),
      ]);

      let applied = 0;
      let notesAdded = false;
      let usedLabel = false;
      let disabledMessage: string | null = null;
      let tagError: string | undefined;
      let tagRawText: string | undefined;
      let suggestionKeyCount = 0;

      // ---- Tag suggestions ----
      if (tagSettled.status === "fulfilled" && tagSettled.value.ok) {
        const data = await tagSettled.value.json().catch(() => ({}));
        if (data?.enabled === false) {
          disabledMessage = data.message ?? "AI is disabled.";
        } else {
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
          const debug = data?.debug as { error?: string; rawText?: string } | undefined;
          usedLabel = data?.hasLabel === true;
          tagError = debug?.error;
          tagRawText = debug?.rawText;
          suggestionKeyCount = Object.keys(s).length;

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
          if (s.material && !fitNotes) {
            setFitNotes(`Material: ${s.material}`);
          }
        }
      } else if (tagSettled.status === "rejected") {
        tagError = friendlyFetchError(tagSettled.reason, "Couldn't auto-tag.");
      }

      // ---- Notes ----
      if (notesSettled.status === "fulfilled" && notesSettled.value.ok) {
        const data = await notesSettled.value.json().catch(() => ({}));
        if (data?.enabled === false) {
          disabledMessage = disabledMessage ?? data.message ?? "AI is disabled.";
        } else {
          const generated = String(data?.notes ?? "").trim();
          if (generated) {
            setNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${generated}` : generated));
            notesAdded = true;
          }
        }
      }

      // ---- Combined message ----
      if (disabledMessage) {
        setAutoTagState("disabled");
        setAutoTagMessage(disabledMessage);
        return;
      }

      const parts: string[] = [];
      if (applied > 0) {
        parts.push(
          `pre-filled ${applied} field${applied === 1 ? "" : "s"}${usedLabel ? " (read brand/size/care from label)" : ""}`,
        );
      }
      if (notesAdded) parts.push("added notes");

      if (parts.length > 0) {
        const head = parts.join(" + ");
        setAutoTagState("done");
        setAutoTagMessage(`${head.charAt(0).toUpperCase()}${head.slice(1)} — review and save.`);
      } else if (tagError) {
        setAutoTagState("error");
        setAutoTagMessage(tagError);
      } else if (suggestionKeyCount === 0 && tagRawText) {
        setAutoTagState("error");
        setAutoTagMessage(`Model returned: ${tagRawText.slice(0, 200)}`);
      } else {
        setAutoTagState("done");
        setAutoTagMessage("No new suggestions — fields already filled or model couldn't tell.");
      }
    } catch (err) {
      console.error(err);
      setAutoTagState("error");
      setAutoTagMessage(friendlyFetchError(err, "Auto-tag failed."));
    }
  }

  // Ask Gemini to grounded-search the brand + subType online and pull
  // back fabric, care, description, retail price. Empty fields fill in;
  // existing values stay untouched. Brand is required.
  async function lookupOnline() {
    if (lookupState === "running") return;
    if (!brand.trim()) {
      setLookupState("error");
      setLookupMessage("Add a brand first — that's what we search for online.");
      return;
    }
    setLookupState("running");
    setLookupMessage(null);
    setLookupSources([]);
    try {
      const res = await fetch("/api/ai/lookup-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: brand.trim(),
          subType: subType || null,
          color: color || null,
          category,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setLookupState("disabled");
        setLookupMessage(data.message ?? "AI is disabled.");
        return;
      }
      if (!res.ok) {
        setLookupState("error");
        setLookupMessage(data?.error ?? `Lookup failed (HTTP ${res.status}).`);
        return;
      }
      const s = (data?.suggestions ?? {}) as {
        material?: string;
        careNotes?: string;
        description?: string;
        retailPrice?: string;
        productUrl?: string;
      };

      let applied = 0;
      // Material → prefix into fitNotes (matches the auto-tag flow).
      if (s.material) {
        const line = `Material: ${s.material}`;
        if (!fitNotes.toLowerCase().includes("material:")) {
          setFitNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
          applied++;
        }
      }
      // Care notes → append to fitNotes if not already present.
      if (s.careNotes) {
        const line = `Care: ${s.careNotes}`;
        if (!fitNotes.toLowerCase().includes("care:")) {
          setFitNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
          applied++;
        }
      }
      // Description + price + url → append to notes.
      const noteLines: string[] = [];
      if (s.description) noteLines.push(s.description);
      if (s.retailPrice) noteLines.push(`Retail: ${s.retailPrice}`);
      if (s.productUrl) noteLines.push(`Source: ${s.productUrl}`);
      if (noteLines.length > 0) {
        const block = noteLines.join("\n");
        const already = noteLines.every((l) => notes.includes(l));
        if (!already) {
          setNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${block}` : block));
          applied++;
        }
      }

      setLookupSources(Array.isArray(data?.sources) ? data.sources.slice(0, 5) : []);
      if (applied > 0) {
        setLookupState("done");
        setLookupMessage(`Pre-filled ${applied} field${applied === 1 ? "" : "s"} from the web — review and save.`);
      } else if (Object.keys(s).length === 0) {
        setLookupState("error");
        setLookupMessage("Couldn't find this product online — try a more specific subType or color.");
      } else {
        setLookupState("done");
        setLookupMessage("Found it, but everything was already filled in.");
      }
    } catch (err) {
      console.error(err);
      setLookupState("error");
      setLookupMessage(friendlyFetchError(err, "Lookup failed."));
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
    // Drop the ?edit=1 query param and refresh — kicks the user back
    // to the read-only detail view.
    router.push(`/wardrobe/${item.id}`);
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
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

      <div className="space-y-2 border-t border-stone-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={autoTag}
            className="btn-ghost text-xs text-blush-600"
            disabled={busy || autoTagState === "running" || lookupState === "running"}
            title="Ask AI to fill empty fields and write notes from the photo"
          >
            {autoTagState === "running" ? "Reading photo…" : "✨ Auto-tag"}
          </button>
          <button
            type="button"
            onClick={lookupOnline}
            className="btn-ghost text-xs text-blush-600"
            disabled={busy || lookupState === "running" || autoTagState === "running" || !brand.trim()}
            title={brand.trim() ? "Ask AI to search the web for material, care, retail price" : "Add a brand first"}
          >
            {lookupState === "running" ? "Looking up…" : "✨ Look up online"}
          </button>
          {autoTagState === "running" && (
            <div className="flex-1 min-w-[10rem]">
              <ProgressBar value={autoTagProgress} label="Reading photo…" />
            </div>
          )}
          {lookupState === "running" && (
            <div className="flex-1 min-w-[10rem]">
              <ProgressBar value={lookupProgress} label="Searching the web…" hint="usually 5–15s" />
            </div>
          )}
          {autoTagState !== "running" && autoTagMessage && (
            <span className={"text-xs " + (autoTagState === "error" ? "text-blush-700" : "text-stone-500")}>
              {autoTagMessage}
            </span>
          )}
        </div>
        {lookupState !== "running" && lookupMessage && (
          <p className={"text-xs " + (lookupState === "error" ? "text-blush-700" : "text-stone-500")}>
            {lookupMessage}
          </p>
        )}
        {lookupSources.length > 0 && (
          <p className="text-xs text-stone-400">
            Sources:{" "}
            {lookupSources.map((s, i) => (
              <span key={s}>
                {i > 0 ? " · " : ""}
                <a
                  href={s}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  title={s}
                >
                  {hostnameOf(s)}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
