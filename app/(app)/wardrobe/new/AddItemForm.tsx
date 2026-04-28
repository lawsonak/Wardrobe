"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CATEGORIES,
  SEASONS,
  ACTIVITIES,
  type Category,
} from "@/lib/constants";
import TagChips from "@/components/TagChips";
import ColorSwatch from "@/components/ColorSwatch";
import BrandInput from "@/components/BrandInput";
import FitDetailsEditor from "@/components/FitDetailsEditor";
import SubtypePicker from "@/components/SubtypePicker";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeSize } from "@/lib/size";
import { serializeFitDetails } from "@/lib/fitDetails";

export default function AddItemForm() {
  const router = useRouter();
  const search = useSearchParams();
  const batchMode = search.get("batch") === "1";

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const labelFileRef = useRef<HTMLInputElement>(null);
  const labelCameraRef = useRef<HTMLInputElement>(null);

  const [original, setOriginal] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [bgRemoved, setBgRemoved] = useState<Blob | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgState, setBgState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [bgError, setBgError] = useState<string | null>(null);
  const [useOriginal, setUseOriginal] = useState(false);

  const [labelPhoto, setLabelPhoto] = useState<File | null>(null);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  const [category, setCategory] = useState<Category>("Tops");
  const [subType, setSubType] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [size, setSize] = useState("");
  const [fitDetails, setFitDetails] = useState<Record<string, string>>({});
  const [fitNotes, setFitNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [autoTagState, setAutoTagState] = useState<"idle" | "running" | "done" | "disabled" | "error">("idle");
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      if (labelUrl) URL.revokeObjectURL(labelUrl);
    };
  }, [originalUrl, bgUrl, labelUrl]);

  async function processFile(picked: File): Promise<File | null> {
    let file = picked;
    if (isHeic(picked)) {
      try {
        file = await heicToJpeg(picked);
      } catch (err) {
        console.error("HEIC conversion failed", err);
        setError("Couldn't read that HEIC photo. Try saving it as JPEG first.");
        setBgState("error");
        return null;
      }
    }
    return file;
  }

  async function runBgRemoval(file: File) {
    setBgState("running");
    setError(null);
    setBgError(null);
    try {
      const out = await removeBackground(file);
      setBgRemoved(out);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      setBgUrl(URL.createObjectURL(out));
      setBgState("done");
    } catch (err) {
      console.error("Background removal failed", err);
      setBgError(err instanceof Error ? err.message : String(err));
      setBgState("error");
    }
  }

  async function retryBgRemoval() {
    if (!original) return;
    resetBackgroundRemover();
    await runBgRemoval(original);
  }

  async function autoTag() {
    if (!original || autoTagState === "running") return;
    setAutoTagState("running");
    setAutoTagMessage(null);
    try {
      const fd = new FormData();
      fd.append("image", original);
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
        seasons?: string[];
        activities?: string[];
        notes?: string;
      };
      let applied = 0;
      if (s.category && !category) { setCategory(s.category); applied++; }
      else if (s.category && CATEGORIES.includes(s.category)) { setCategory(s.category); applied++; }
      if (s.subType && !subType) { setSubType(s.subType); applied++; }
      if (s.color && !color) { setColor(s.color); applied++; }
      if (s.brand && !brand) { setBrand(s.brand); setBrandId(null); applied++; }
      if (s.seasons && seasons.length === 0) { setSeasons(s.seasons.filter((x) => SEASONS.includes(x as never))); applied++; }
      if (s.activities && activities.length === 0) { setActivities(s.activities.filter((x) => ACTIVITIES.includes(x as never))); applied++; }
      if (s.notes && !notes) { setNotes(s.notes); applied++; }
      setAutoTagState("done");
      setAutoTagMessage(applied > 0 ? `Pre-filled ${applied} field${applied === 1 ? "" : "s"} — review before saving.` : "No new suggestions.");
    } catch (err) {
      console.error(err);
      setAutoTagState("error");
      setAutoTagMessage("Auto-tag failed.");
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(null);
    setBgRemoved(null);
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(null);
    setUseOriginal(false);
    setError(null);
    setBgState("running");

    const file = await processFile(picked);
    if (!file) return;

    setOriginal(file);
    setOriginalUrl(URL.createObjectURL(file));

    await runBgRemoval(file);
  }

  async function onPickLabelPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;

    if (labelUrl) URL.revokeObjectURL(labelUrl);
    const file = await processFile(picked);
    if (!file) return;
    setLabelPhoto(file);
    setLabelUrl(URL.createObjectURL(file));
  }

  async function submit(addAnother: boolean) {
    if (!original) {
      setError("Please add a photo first.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const fd = new FormData();
    fd.append("image", original);
    if (bgRemoved && !useOriginal) {
      fd.append("imageBgRemoved", new File([bgRemoved], "bg.png", { type: "image/png" }));
    }
    if (labelPhoto) {
      fd.append("labelImage", labelPhoto);
    }
    fd.append("category", category);
    if (subType) fd.append("subType", subType);
    if (color) fd.append("color", color);
    if (brand) fd.append("brand", brand);
    if (brandId) fd.append("brandId", brandId);
    if (size) fd.append("size", normalizeSize(size, category));
    const fitJson = serializeFitDetails(fitDetails);
    if (fitJson) fd.append("fitDetails", fitJson);
    if (fitNotes.trim()) fd.append("fitNotes", fitNotes.trim());
    if (notes) fd.append("notes", notes);
    seasons.forEach((s) => fd.append("seasons", s));
    activities.forEach((a) => fd.append("activities", a));
    if (isFavorite) fd.append("isFavorite", "1");

    try {
      const res = await fetch("/api/items", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      if (addAnother || batchMode) {
        // Reset form for next item
        setOriginal(null);
        if (originalUrl) URL.revokeObjectURL(originalUrl);
        setOriginalUrl(null);
        setBgRemoved(null);
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        setBgUrl(null);
        setLabelPhoto(null);
        if (labelUrl) URL.revokeObjectURL(labelUrl);
        setLabelUrl(null);
        setBgState("idle");
        setSubType("");
        setColor(null);
        setSize("");
        setBrand("");
        setBrandId(null);
        setFitDetails({});
        setFitNotes("");
        setNotes("");
        setIsFavorite(false);
        if (fileRef.current) fileRef.current.value = "";
        if (cameraRef.current) cameraRef.current.value = "";
        if (labelFileRef.current) labelFileRef.current.value = "";
        setSubmitting(false);
        setSavedToast(batchMode ? "Saved. Snap the next one." : "Saved.");
        if (batchMode) {
          setTimeout(() => cameraRef.current?.click(), 80);
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        setTimeout(() => setSavedToast(null), 2200);
        router.refresh();
      } else {
        router.push("/wardrobe");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong saving that item.");
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(batchMode);
  }

  const previewUrl = !useOriginal && bgUrl ? bgUrl : originalUrl;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Main photo */}
      <div className="card p-4">
        <div className="tile-bg mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-2xl">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" className="h-full w-full object-contain p-3" />
          ) : (
            <div className="text-center px-4">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blush-100">
                <svg className="h-8 w-8 text-blush-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                </svg>
              </div>
              <p className="font-medium text-stone-700">Tap to take a photo</p>
              <p className="text-xs text-stone-400 mt-1">or choose from your library</p>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={onPickFile} className="hidden" />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} className="hidden" />
        <div className="flex flex-wrap items-center gap-2">
          {/* Camera is primary on mobile */}
          <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => cameraRef.current?.click()}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
            </svg>
            {original ? "Retake" : "Take photo"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            {original ? "Change" : "Choose from library"}
          </button>
          {bgState === "running" && (
            <span className="text-sm text-stone-500">Processing…</span>
          )}
          {bgState === "done" && (
            <label className="chip chip-off cursor-pointer">
              <input type="checkbox" className="mr-1" checked={useOriginal} onChange={(e) => setUseOriginal(e.target.checked)} />
              Use original
            </label>
          )}
          {bgState === "error" && (
            <>
              <span className="text-sm text-blush-700">
                Background removal failed{bgError ? `: ${bgError}` : "."}
              </span>
              <button
                type="button"
                onClick={retryBgRemoval}
                className="btn-ghost text-xs text-blush-600"
              >
                Try again
              </button>
            </>
          )}
        </div>
        {original && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
            <button
              type="button"
              onClick={autoTag}
              className="btn-ghost text-xs text-blush-600"
              disabled={autoTagState === "running"}
              title="Ask AI to suggest tags for this photo"
            >
              {autoTagState === "running" ? "Reading photo…" : "✨ Auto-tag"}
            </button>
            {autoTagMessage && (
              <span className={"text-xs " + (autoTagState === "error" ? "text-blush-700" : "text-stone-500")}>
                {autoTagMessage}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="card space-y-4 p-4">
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={category}
            onChange={(e) => { setCategory(e.target.value as Category); setSubType(""); }}
          >
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
              placeholder="e.g. M, 8, 32x30"
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
          <textarea className="input min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Material, fit notes, where you got it…" />
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
          Mark as favorite
        </label>
      </div>

      {/* Label / tag photo */}
      <div className="card p-4">
        <p className="label mb-2">Label / tag photo <span className="normal-case font-normal text-stone-400">(optional)</span></p>
        <p className="text-xs text-stone-500 mb-3">Snap the brand, size, or care tag so you can reference it later.</p>
        {labelUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={labelUrl} alt="Label photo" className="mb-3 max-h-48 w-auto rounded-xl bg-cream-50 object-contain p-1 ring-1 ring-stone-100" />
        )}
        <input ref={labelFileRef} type="file" accept="image/*,.heic,.heif" onChange={onPickLabelPhoto} className="hidden" />
        <input ref={labelCameraRef} type="file" accept="image/*" capture="environment" onChange={onPickLabelPhoto} className="hidden" />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => labelCameraRef.current?.click()}>
            📷 Take photo
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => labelFileRef.current?.click()}>
            Choose
          </button>
          {labelPhoto && (
            <button type="button" className="btn-ghost text-xs text-stone-400" onClick={() => { setLabelPhoto(null); if (labelUrl) URL.revokeObjectURL(labelUrl); setLabelUrl(null); }}>
              Remove
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-blush-700">{error}</p>}

      <div className="flex gap-2 pb-2">
        <button type="submit" className="btn-primary flex-1" disabled={submitting}>
          {submitting ? "Saving…" : batchMode ? "Save & next" : "Save to closet"}
        </button>
        {!batchMode && (
          <button
            type="button"
            className="btn-secondary"
            disabled={submitting}
            onClick={() => submit(true)}
            title="Save and add another item"
          >
            + Another
          </button>
        )}
      </div>

      {savedToast && (
        <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4 sm:bottom-8">
          <div className="rounded-full bg-blush-600 px-4 py-2 text-sm text-white shadow-card">
            {savedToast}
          </div>
        </div>
      )}
    </form>
  );
}
