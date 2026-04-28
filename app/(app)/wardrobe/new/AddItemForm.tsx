"use client";

import { useEffect, useRef, useState } from "react";
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
import { removeBackground } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";

export default function AddItemForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [original, setOriginal] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [bgRemoved, setBgRemoved] = useState<Blob | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgState, setBgState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [useOriginal, setUseOriginal] = useState(false);

  const [category, setCategory] = useState<Category>("Tops");
  const [subType, setSubType] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
    };
  }, [originalUrl, bgUrl]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;

    // Reset preview state immediately so the user sees something is happening.
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(null);
    setBgRemoved(null);
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(null);
    setUseOriginal(false);
    setError(null);

    // HEIC from iPhones can't be rendered or processed by browsers. Convert
    // to JPEG up front so previews, bg removal, and the saved file all work.
    let file = picked;
    if (isHeic(picked)) {
      setBgState("running");
      try {
        file = await heicToJpeg(picked);
      } catch (err) {
        console.error("HEIC conversion failed", err);
        setError("Couldn't read that HEIC photo. Try saving it as JPEG first.");
        setBgState("error");
        return;
      }
    }

    setOriginal(file);
    setOriginalUrl(URL.createObjectURL(file));

    setBgState("running");
    try {
      const out = await removeBackground(file);
      setBgRemoved(out);
      setBgUrl(URL.createObjectURL(out));
      setBgState("done");
    } catch (err) {
      console.error("Background removal failed", err);
      setBgState("error");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    fd.append("category", category);
    if (subType) fd.append("subType", subType);
    if (color) fd.append("color", color);
    if (brand) fd.append("brand", brand);
    if (size) fd.append("size", size);
    if (notes) fd.append("notes", notes);
    seasons.forEach((s) => fd.append("seasons", s));
    activities.forEach((a) => fd.append("activities", a));
    if (isFavorite) fd.append("isFavorite", "1");

    try {
      const res = await fetch("/api/items", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.push("/wardrobe");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong saving that item.");
      setSubmitting(false);
    }
  }

  const previewUrl = !useOriginal && bgUrl ? bgUrl : originalUrl;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="card p-4">
        <div className="tile-bg mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-2xl">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" className="h-full w-full object-contain p-3" />
          ) : (
            <div className="text-center">
              <p className="font-display text-2xl text-blush-700">📷</p>
              <p className="text-sm text-stone-500">Tap below to take or choose a photo</p>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={onPickFile}
          className="hidden"
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickFile}
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
            {original ? "Change photo" : "Choose photo"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => cameraRef.current?.click()}>
            Take photo
          </button>
          {bgState === "running" && (
            <span className="text-sm text-stone-500">Removing background…</span>
          )}
          {bgState === "done" && (
            <label className="chip chip-off cursor-pointer">
              <input
                type="checkbox"
                className="mr-1"
                checked={useOriginal}
                onChange={(e) => setUseOriginal(e.target.checked)}
              />
              Use original
            </label>
          )}
          {bgState === "error" && (
            <span className="text-sm text-stone-500">Background removal failed — using original.</span>
          )}
        </div>
      </div>

      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <input
              className="input"
              list="subtype-suggestions"
              value={subType}
              placeholder={SUBTYPES_BY_CATEGORY[category]?.[0] ?? ""}
              onChange={(e) => setSubType(e.target.value)}
            />
            <datalist id="subtype-suggestions">
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
          Mark as favorite
        </label>
      </div>

      {error && <p className="text-sm text-blush-700">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={submitting}>
          {submitting ? "Saving…" : "Save to closet"}
        </button>
      </div>
    </form>
  );
}
