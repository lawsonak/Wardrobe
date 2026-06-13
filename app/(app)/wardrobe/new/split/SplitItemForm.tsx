"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BEAUTY_CATEGORIES,
  CATEGORIES,
  COLOR_NAMES,
  SPICY_CATEGORIES,
} from "@/lib/constants";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation } from "@/lib/imageOrientation";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { fetchWithRetry, friendlyFetchError } from "@/lib/fetchRetry";
import { useTimedProgress } from "@/lib/progress";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import ProgressBar from "@/components/ProgressBar";

// Detection coming back from /api/ai/detect-items.
type Detection = {
  /** [ymin, xmin, ymax, xmax] in 0–1000 normalized coords. */
  box: [number, number, number, number];
  suggestion: {
    category?: string;
    subType?: string;
    color?: string;
    brand?: string;
    isBeauty?: boolean;
    shadeName?: string;
    shadeHex?: string;
    finish?: string;
    confidence?: number;
  };
};

// Per-row editable state. Carries the detection + the user's
// adjustments. `selected=false` skips the row on save. `cropUrl` is a
// browser-side blob URL of the cropped region so the user sees a
// thumbnail without waiting for a round-trip.
type Row = {
  id: string;
  selected: boolean;
  box: [number, number, number, number];
  cropUrl: string;
  category: string;
  subType: string;
  color: string;
  brand: string;
  isBeauty: boolean;
  isBackroom: boolean;
  shadeName: string;
  shadeHex: string;
  finish: string;
  confidence: number | null;
};

export default function SplitItemForm({
  defaultBeauty,
  defaultBackroom,
}: {
  defaultBeauty: boolean;
  defaultBackroom: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [detectState, setDetectState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const detectProgress = useTimedProgress(detectState === "running", 12);

  // Dirty once a photo is picked or detections are on screen — all
  // of that is lost on navigate-away. submitting itself navigates
  // programmatically on success, which the guard ignores.
  useUnsavedChanges((!!source || rows.length > 0) && !submitting);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      for (const r of rows) URL.revokeObjectURL(r.cropUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!picked) return;
    let file = picked;
    if (isHeic(picked)) {
      try {
        file = await heicToJpeg(picked);
      } catch (err) {
        console.error("HEIC conversion failed", err);
        toast("Couldn't read that HEIC photo. Try saving it as JPEG.", "error");
        return;
      }
    }
    try {
      file = await normalizeOrientation(file);
    } catch (err) {
      console.warn("orientation normalize failed", err);
    }
    // Reset any previous detection.
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    for (const r of rows) URL.revokeObjectURL(r.cropUrl);
    setRows([]);
    setSource(file);
    setSourceUrl(URL.createObjectURL(file));

    // Read dimensions for the cropping step. Passed straight through
    // to detect() rather than stored — we only need it during the
    // detection round-trip.
    const dims = await readImageDims(file);
    await detect(file, dims);
  }

  async function detect(file: File, dims: { w: number; h: number } | null) {
    setDetectState("running");
    setDetectMessage(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetchWithRetry(
        "/api/ai/detect-items",
        { method: "POST", body: fd },
        { timeoutMs: 90_000 },
      );
      const data = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        items?: Detection[];
        message?: string;
        debug?: { error?: string };
      };
      if (data?.enabled === false) {
        setDetectState("error");
        setDetectMessage(data.message ?? "AI is disabled.");
        return;
      }
      const detections = Array.isArray(data.items) ? data.items : [];
      if (detections.length === 0) {
        setDetectState("done");
        setDetectMessage(
          "No items detected. Try a flat-lay shot (pieces laid out side-by-side) or use the regular Add page for a single item.",
        );
        return;
      }
      // Build the editable rows + cropped thumbnails. Crops happen in
      // the browser via canvas so the picker can render instantly
      // without another round-trip.
      const newRows: Row[] = [];
      for (const d of detections) {
        const cropUrl = dims ? await cropToBlobUrl(file, dims, d.box) : "";
        const s = d.suggestion ?? {};
        const looksBeauty =
          s.isBeauty === true ||
          (typeof s.category === "string" &&
            (BEAUTY_CATEGORIES as readonly string[]).includes(s.category));
        newRows.push({
          id: Math.random().toString(36).slice(2),
          selected: true,
          box: d.box,
          cropUrl,
          category: s.category ?? (looksBeauty ? "Lipstick" : "Tops"),
          subType: s.subType ?? "",
          color: s.color ?? "",
          brand: s.brand ?? "",
          isBeauty: looksBeauty,
          isBackroom: defaultBackroom,
          shadeName: s.shadeName ?? "",
          shadeHex: s.shadeHex ?? "",
          finish: s.finish ?? "",
          confidence: typeof s.confidence === "number" ? s.confidence : null,
        });
      }
      setRows(newRows);
      setDetectState("done");
      setDetectMessage(
        `Detected ${newRows.length} item${newRows.length === 1 ? "" : "s"} — review, deselect any false positives, then save.`,
      );
    } catch (err) {
      console.error(err);
      setDetectState("error");
      setDetectMessage(friendlyFetchError(err, "Detection failed."));
    }
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!source) return;
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      toast("Pick at least one item to save.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const detections = selected.map((r) => ({
        box: r.box,
        category: r.category,
        subType: r.subType || undefined,
        color: r.color || undefined,
        brand: r.brand || undefined,
        isBeauty: r.isBeauty,
        isBackroom: r.isBackroom,
        shadeName: r.isBeauty && r.shadeName ? r.shadeName : undefined,
        shadeHex: r.isBeauty && r.shadeHex ? r.shadeHex : undefined,
        finish: r.isBeauty && r.finish ? r.finish : undefined,
      }));
      const fd = new FormData();
      fd.append("image", source);
      fd.append("detections", JSON.stringify(detections));
      const res = await fetch("/api/items/split", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { count: number; errors?: unknown[] };
      haptic("success");
      const failed = Array.isArray(data.errors) ? data.errors.length : 0;
      toast(
        failed > 0
          ? `Saved ${data.count} item${data.count === 1 ? "" : "s"}, ${failed} skipped.`
          : `Saved ${data.count} item${data.count === 1 ? "" : "s"}.`,
      );
      router.push(defaultBeauty ? "/wardrobe/beauty" : defaultBackroom ? "/wardrobe/backroom" : "/wardrobe");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast(err instanceof Error ? err.message : "Couldn't save", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // Hidden inputs first, then the picker UI.
  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={onPickFile}
        className="hidden"
        aria-label="Choose photo from library"
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPickFile}
        className="hidden"
        aria-label="Take photo with camera"
      />

      {!source && (
        <div className="card space-y-3 p-6 text-center">
          <p className="text-sm text-stone-600">
            Snap or upload one photo of multiple items laid out together. AI will detect each piece
            and let you tag them all in one go.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => cameraRef.current?.click()}>
              📷 Take photo
            </button>
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
              🖼️ Choose from library
            </button>
          </div>
          <p className="text-xs text-stone-400">
            Works best on flat-lays. Outfit-on-body shots are detected as a single piece and
            should use the regular Add page instead.
          </p>
        </div>
      )}

      {source && sourceUrl && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="tile-bg flex items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt="Source photo"
                className="max-h-64 w-auto object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-stone-500">
              <span>Source photo</span>
              <button
                type="button"
                className="btn-ghost text-xs text-stone-500"
                onClick={() => fileRef.current?.click()}
              >
                Change
              </button>
            </div>
          </div>

          {detectState === "running" && (
            <div className="card p-4">
              <ProgressBar value={detectProgress} label="Detecting items…" />
              <p className="mt-1 text-xs text-stone-500">
                Usually 5-15 seconds depending on photo size.
              </p>
            </div>
          )}

          {detectMessage && detectState !== "running" && (
            <div
              className={
                detectState === "error"
                  ? "rounded-xl bg-blush-50 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200"
                  : "rounded-xl bg-cream-50 px-3 py-2 text-sm text-stone-700 ring-1 ring-stone-200"
              }
            >
              {detectMessage}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <ul className="space-y-3">
                {rows.map((r) => (
                  <RowEditor key={r.id} row={r} onChange={(patch) => updateRow(r.id, patch)} />
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-end gap-2 pb-4">
                <p className="mr-auto text-xs text-stone-500">
                  {rows.filter((r) => r.selected).length} of {rows.length} selected
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={submitting || rows.every((r) => !r.selected)}
                  onClick={save}
                >
                  {submitting
                    ? "Saving…"
                    : `Save ${rows.filter((r) => r.selected).length} item${rows.filter((r) => r.selected).length === 1 ? "" : "s"} to closet`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RowEditor({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  // Switching the beauty toggle should snap the category to a value
  // that's selectable in the new vocabulary, so the dropdown isn't
  // sitting on a value that's no longer in the option list.
  function toggleBeauty(next: boolean) {
    const beautyList: readonly string[] = BEAUTY_CATEGORIES;
    const clothingList: readonly string[] = row.isBackroom ? SPICY_CATEGORIES : CATEGORIES;
    let category = row.category;
    if (next && !beautyList.includes(category)) category = "Lipstick";
    if (!next && !clothingList.includes(category)) category = clothingList[0];
    onChange({ isBeauty: next, category });
  }
  function toggleBackroom(next: boolean) {
    const list: readonly string[] = row.isBeauty
      ? BEAUTY_CATEGORIES
      : next
        ? SPICY_CATEGORIES
        : CATEGORIES;
    let category = row.category;
    if (!list.includes(category)) category = list[0];
    onChange({ isBackroom: next, category });
  }

  const optionList = row.isBeauty
    ? BEAUTY_CATEGORIES
    : row.isBackroom
      ? SPICY_CATEGORIES
      : CATEGORIES;

  return (
    <li
      className={
        "card overflow-hidden " + (!row.selected ? "opacity-50" : "")
      }
    >
      <div className="grid grid-cols-[auto_1fr] gap-3 p-3 sm:grid-cols-[6rem_1fr]">
        <div className="flex flex-col items-center gap-2">
          <div className="tile-bg h-20 w-20 overflow-hidden rounded-xl ring-1 ring-stone-100 sm:h-24 sm:w-24">
            {row.cropUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.cropUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={row.selected}
              onChange={(e) => onChange({ selected: e.target.checked })}
            />
            Save
          </label>
          {row.confidence !== null && (
            <span className="text-[10px] uppercase tracking-wide text-stone-400">
              {Math.round(row.confidence * 100)}%
            </span>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => toggleBeauty(!row.isBeauty)}
              aria-pressed={row.isBeauty}
              className={"chip " + (row.isBeauty ? "chip-on" : "chip-off")}
            >
              <span aria-hidden className="mr-1">💄</span>
              Beauty
            </button>
            <button
              type="button"
              onClick={() => toggleBackroom(!row.isBackroom)}
              aria-pressed={row.isBackroom}
              className={"chip " + (row.isBackroom ? "chip-on" : "chip-off")}
            >
              <span aria-hidden className="mr-1">🌶</span>
              Spicy
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-stone-500">Category</span>
              <select
                className="input mt-0.5 py-1 text-sm"
                value={row.category}
                onChange={(e) => onChange({ category: e.target.value })}
                disabled={!row.selected}
              >
                {optionList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-stone-500">Type</span>
              <input
                type="text"
                className="input mt-0.5 py-1 text-sm"
                value={row.subType}
                onChange={(e) => onChange({ subType: e.target.value })}
                disabled={!row.selected}
                placeholder="e.g. blazer"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-stone-500">Color</span>
              <select
                className="input mt-0.5 py-1 text-sm"
                value={row.color}
                onChange={(e) => onChange({ color: e.target.value })}
                disabled={!row.selected}
              >
                <option value="">—</option>
                {COLOR_NAMES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-stone-500">Brand</span>
              <input
                type="text"
                className="input mt-0.5 py-1 text-sm"
                value={row.brand}
                onChange={(e) => onChange({ brand: e.target.value })}
                disabled={!row.selected}
              />
            </label>
          </div>

          {row.isBeauty && (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-blush-50/60 p-2">
              <label className="text-xs">
                <span className="block text-stone-500">Shade</span>
                <input
                  type="text"
                  className="input mt-0.5 py-1 text-sm"
                  value={row.shadeName}
                  onChange={(e) => onChange({ shadeName: e.target.value })}
                  disabled={!row.selected}
                  placeholder="Ruby Woo"
                />
              </label>
              <label className="text-xs">
                <span className="block text-stone-500">Swatch (#hex)</span>
                <div className="mt-0.5 flex items-center gap-1">
                  {row.shadeHex && (
                    <span
                      className="h-5 w-5 shrink-0 rounded-full ring-1 ring-stone-300"
                      style={{ backgroundColor: row.shadeHex }}
                      aria-hidden
                    />
                  )}
                  <input
                    type="text"
                    className="input py-1 text-sm"
                    value={row.shadeHex}
                    onChange={(e) => onChange({ shadeHex: e.target.value })}
                    disabled={!row.selected}
                    placeholder="#a82c52"
                  />
                </div>
              </label>
              <label className="col-span-2 text-xs">
                <span className="block text-stone-500">Finish</span>
                <input
                  type="text"
                  className="input mt-0.5 py-1 text-sm"
                  value={row.finish}
                  onChange={(e) => onChange({ finish: e.target.value })}
                  disabled={!row.selected}
                  placeholder="matte / satin / gloss / …"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// Browser-side helpers: read image dimensions + crop a region of a
// File into a blob URL. Both go through a canvas, no external deps.
async function readImageDims(file: File): Promise<{ w: number; h: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function cropToBlobUrl(
  file: File,
  dims: { w: number; h: number },
  box: [number, number, number, number],
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const [ymin, xmin, ymax, xmax] = box;
    const left = Math.max(0, Math.round((xmin / 1000) * dims.w));
    const top = Math.max(0, Math.round((ymin / 1000) * dims.h));
    const right = Math.min(dims.w, Math.round((xmax / 1000) * dims.w));
    const bottom = Math.min(dims.h, Math.round((ymax / 1000) * dims.h));
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, left, top, w, h, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    if (!blob) return "";
    return URL.createObjectURL(blob);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
