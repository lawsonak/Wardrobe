"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CATEGORIES,
  SEASONS,
  ACTIVITIES,
  SPICY_CATEGORIES,
  BEAUTY_CATEGORIES,
  BEAUTY_CATEGORY_GROUPS,
} from "@/lib/constants";
import TagChips from "@/components/TagChips";
import ColorSwatch from "@/components/ColorSwatch";
import BrandInput from "@/components/BrandInput";
import FitDetailsEditor from "@/components/FitDetailsEditor";
import SubtypePicker from "@/components/SubtypePicker";
import BarcodeScanner from "@/components/BarcodeScanner";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation, rotateImage } from "@/lib/imageOrientation";
import { normalizeSize } from "@/lib/size";
import { serializeFitDetails } from "@/lib/fitDetails";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { fetchWithRetry, friendlyFetchError } from "@/lib/fetchRetry";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";

// Common finish suggestions surfaced via <datalist> on the beauty
// finish input. The column accepts anything (some brands name finishes
// idiosyncratically — "soft matte", "velvet shine") so this is a hint
// list, not a constraint.
const FINISH_SUGGESTIONS = [
  "matte",
  "satin",
  "gloss",
  "cream",
  "shimmer",
  "glitter",
  "metallic",
  "sheer",
  "natural",
  "dewy",
];

export default function AddItemForm({
  defaultBackroom = false,
  defaultBeauty = false,
}: {
  defaultBackroom?: boolean;
  defaultBeauty?: boolean;
}) {
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
  const [bgProgress, setBgProgress] = useState<number>(0);
  const [bgPhase, setBgPhase] = useState<"fetch" | "compute" | "other" | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [useOriginal, setUseOriginal] = useState(false);

  const [labelPhoto, setLabelPhoto] = useState<File | null>(null);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  // Label bg removal mirrors the main-photo flow — labels read way
  // better in the strip with the closet-floor / hand-holding-it
  // background dropped. Best-effort: if the model fails or is
  // unavailable, the label still uploads as-is.
  const [labelBgRemoved, setLabelBgRemoved] = useState<Blob | null>(null);

  const [category, setCategory] = useState<string>(
    defaultBeauty ? "Lipstick" : defaultBackroom ? "Lingerie" : "Tops",
  );
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
  const [isBackroom, setIsBackroom] = useState(defaultBackroom);
  // Beauty mode: when on, the category dropdown swaps to
  // BEAUTY_CATEGORIES (sectioned by group via <optgroup>), the
  // shade + finish row appears, and the form's POST flips
  // isBeauty=1 so the item lands on /wardrobe/beauty.
  const [isBeauty, setIsBeauty] = useState(defaultBeauty);
  const [shadeName, setShadeName] = useState("");
  const [shadeHex, setShadeHex] = useState("");
  const [finish, setFinish] = useState("");
  // Barcode scanner sheet (mobile-first; manual UPC fallback when
  // BarcodeDetector isn't available). Only surfaced on beauty mode.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopenCamera, setReopenCamera] = useState(false);

  // "You might already own this" prompt. When the upload response
  // includes `similar` matches (within Hamming distance threshold),
  // we hold off on resetting / navigating and surface the matches
  // here so the user can decide. `pendingItemId` is the id of the
  // item we just saved — kept around so "Remove this one" can DELETE
  // it without a re-lookup.
  type SimilarMatch = {
    id: string;
    distance: number;
    imagePath: string;
    imageBgRemovedPath: string | null;
    category: string;
    subType: string | null;
    color: string | null;
    brand: string | null;
  };
  const [similarMatches, setSimilarMatches] = useState<SimilarMatch[] | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);
  const [autoTagState, setAutoTagState] = useState<"idle" | "running" | "done" | "disabled" | "error">("idle");
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);
  const autoTagProgress = useTimedProgress(autoTagState === "running", 18);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      if (labelUrl) URL.revokeObjectURL(labelUrl);
    };
  }, [originalUrl, bgUrl, labelUrl]);

  // After a successful batch save, reopen the camera once the form has
  // finished resetting (any preview elements unmounted, refs cleared).
  // Driven by state instead of setTimeout so the camera always fires.
  useEffect(() => {
    if (reopenCamera && !original) {
      cameraRef.current?.click();
      setReopenCamera(false);
    }
  }, [reopenCamera, original]);

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
    // Bake EXIF orientation into pixels before any other processing
    // so canvas-based steps (bg removal, rotation, etc.) see straight-up bytes.
    try {
      file = await normalizeOrientation(file);
    } catch (err) {
      console.warn("orientation normalize failed, using original", err);
    }
    return file;
  }

  // Ask the AI which way the printed text on a label is facing, then
  // physically rotate the bytes so the words are right-side-up. Falls
  // back to the input on any failure (including AI off → rotation=0).
  async function rotateLabelToUpright(file: File): Promise<File> {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/ai/rotate-label", { method: "POST", body: fd });
      if (!res.ok) return file;
      const data = (await res.json().catch(() => ({}))) as { rotation?: number };
      const r = data.rotation;
      if (r === 90 || r === 180 || r === 270) {
        return await rotateImage(file, r);
      }
      return file;
    } catch (err) {
      console.warn("label rotate failed", err);
      return file;
    }
  }

  async function runBgRemoval(file: File) {
    setBgState("running");
    setBgProgress(0);
    setBgPhase(null);
    setError(null);
    setBgError(null);
    try {
      const out = await removeBackground(file, {
        onProgress: (p) => {
          setBgPhase(p.phase);
          setBgProgress(p.fraction);
        },
      });
      setBgRemoved(out);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      setBgUrl(URL.createObjectURL(out));
      setBgProgress(1);
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

  // Single AI button — runs the tag + notes calls in parallel and
  // applies whichever results come back.
  async function autoTag() {
    if (!original || autoTagState === "running") return;
    setAutoTagState("running");
    setAutoTagMessage(null);
    try {
      const tagFd = new FormData();
      tagFd.append("image", original);
      if (labelPhoto) tagFd.append("labelImage", labelPhoto);

      const notesFd = new FormData();
      notesFd.append("image", original);
      if (labelPhoto) notesFd.append("labelImage", labelPhoto);
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

      // ---- Tag ----
      if (tagSettled.status === "fulfilled" && tagSettled.value.ok) {
        const data = await tagSettled.value.json().catch(() => ({}));
        if (data?.enabled === false) {
          disabledMessage = data.message ?? "AI is disabled.";
        } else {
          const s = (data?.suggestions ?? {}) as {
            category?: string;
            subType?: string;
            color?: string;
            brand?: string;
            size?: string;
            seasons?: string[];
            activities?: string[];
            material?: string;
            careNotes?: string;
            notes?: string;
            // Beauty-only fields. Filled when the model returns
            // isBeauty=true (or when the category is one of
            // BEAUTY_CATEGORIES — we also infer from category for
            // belt-and-braces).
            shadeName?: string;
            shadeHex?: string;
            finish?: string;
            isBeauty?: boolean;
          };
          const debug = data?.debug as { error?: string; rawText?: string } | undefined;
          usedLabel = data?.hasLabel === true;
          tagError = debug?.error;
          tagRawText = debug?.rawText;
          suggestionKeyCount = Object.keys(s).length;

          // Treat the suggestion as a beauty item when the model said
          // so explicitly, or when the suggested category lives in the
          // beauty vocabulary. Belt-and-braces — older prompt versions
          // might omit `isBeauty` even with a beauty category.
          const looksBeauty =
            s.isBeauty === true ||
            (typeof s.category === "string" &&
              (BEAUTY_CATEGORIES as readonly string[]).includes(s.category));

          const validCategory =
            s.category &&
            ((CATEGORIES as readonly string[]).includes(s.category) ||
              (BEAUTY_CATEGORIES as readonly string[]).includes(s.category));
          if (validCategory && s.category !== category) {
            setCategory(s.category!);
            applied++;
          }
          if (looksBeauty && !isBeauty) {
            setIsBeauty(true);
            applied++;
          }
          if (s.subType && !subType) { setSubType(s.subType); applied++; }
          if (s.color && !color) { setColor(s.color); applied++; }
          if (s.brand && !brand) { setBrand(s.brand); setBrandId(null); applied++; }
          if (s.size && !size) { setSize(s.size); applied++; }
          if (s.shadeName && !shadeName) { setShadeName(s.shadeName); applied++; }
          if (s.shadeHex && !shadeHex) {
            const hex = s.shadeHex.startsWith("#") ? s.shadeHex : `#${s.shadeHex}`;
            setShadeHex(hex);
            applied++;
          }
          if (s.finish && !finish) { setFinish(s.finish); applied++; }
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
          `pre-filled ${applied} field${applied === 1 ? "" : "s"}${usedLabel ? " (read brand/size/care from the label)" : ""}`,
        );
      }
      if (notesAdded) parts.push("added notes");

      if (parts.length > 0) {
        const head = parts.join(" + ");
        setAutoTagState("done");
        setAutoTagMessage(`${head.charAt(0).toUpperCase()}${head.slice(1)} — review before saving.`);
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
    const base = await processFile(picked);
    if (!base) return;
    // AI right-side-up pass — text on tags often gets shot at any
    // angle. EXIF rotation only fixes camera tilt, not the tag itself.
    const file = await rotateLabelToUpright(base);
    setLabelPhoto(file);
    setLabelUrl(URL.createObjectURL(file));
    // Kick off bg removal in the background. Don't await — the user
    // can keep filling out fields while it runs. If they hit Save
    // before it finishes the submit just sends the raw label, same
    // shape as before.
    setLabelBgRemoved(null);
    try {
      const out = await removeBackground(file);
      setLabelBgRemoved(out);
    } catch (err) {
      console.warn("label bg removal failed", err);
    }
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
      // Send the bg-removed cutout if it finished in time. If the
      // user hit Save while bg removal was still running we just
      // skip — server will save the raw label, the strip falls
      // back to it, and a future "redo bg removal" pass can fill
      // it in.
      if (labelBgRemoved) {
        fd.append(
          "labelImageBgRemoved",
          new File([labelBgRemoved], "label-bg.png", { type: "image/png" }),
        );
      }
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
    if (isBackroom) fd.append("isBackroom", "1");
    if (isBeauty) fd.append("isBeauty", "1");
    if (shadeName.trim()) fd.append("shadeName", shadeName.trim());
    if (shadeHex.trim()) fd.append("shadeHex", shadeHex.trim());
    if (finish.trim()) fd.append("finish", finish.trim());

    try {
      const res = await fetch("/api/items", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => ({}))) as {
        item?: { id: string };
        similar?: SimilarMatch[];
      };
      haptic("success");

      // "You might already own this" check. Server returned at least
      // one item with a perceptual hash within the duplicate
      // threshold — pause the finalize flow and let the user decide
      // before they end up with two photos of the same blouse.
      if (data.similar && data.similar.length > 0 && data.item?.id) {
        setPendingItemId(data.item.id);
        setSimilarMatches(data.similar);
        setSubmitting(false);
        return;
      }

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
        setLabelBgRemoved(null);
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
        toast(batchMode ? "Saved. Snap the next one." : "Saved");
        if (batchMode) {
          setReopenCamera(true);
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        router.refresh();
      } else {
        toast("Saved to closet");
        router.push("/wardrobe");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong saving that item.");
      toast("Couldn't save that item", "error");
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(batchMode);
  }

  // "Keep both" path: close the prompt and head to the closet. We
  // skip the batch-mode reset on purpose — once the user has made an
  // explicit "yes I want both" decision, surfacing the camera again
  // immediately feels disorienting.
  function similarKeepBoth() {
    setSimilarMatches(null);
    setPendingItemId(null);
    toast("Saved to closet");
    router.push("/wardrobe");
    router.refresh();
  }

  // "Remove this one" path: DELETE the just-saved item and route the
  // user to the existing match so they can see what's already there.
  // The DELETE endpoint already cascades through outfit / collection
  // memberships and unlinks photos; for a brand-new item with no
  // memberships yet, the result is a clean undo.
  async function similarRemoveAndGoToMatch(matchId: string) {
    if (!pendingItemId) return;
    setSimilarBusy(true);
    try {
      await fetch(`/api/items/${pendingItemId}`, { method: "DELETE" });
      toast("Kept the existing one");
      router.push(`/wardrobe/${matchId}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't remove the duplicate", "error");
      setSimilarBusy(false);
    }
  }

  const previewUrl = !useOriginal && bgUrl ? bgUrl : originalUrl;

  return (
    <>
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={onPickFile}
          className="hidden"
          aria-label="Choose item photo from library"
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickFile}
          className="hidden"
          aria-label="Take item photo with camera"
        />
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
            <div className="flex-1 min-w-[10rem]">
              <ProgressBar
                value={bgProgress}
                label={
                  bgPhase === "fetch"
                    ? "Loading model…"
                    : bgPhase === "compute"
                      ? "Removing background…"
                      : "Preparing…"
                }
                hint={`${Math.round(bgProgress * 100)}%`}
              />
            </div>
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
              title="Ask AI to fill empty fields and write notes from this photo"
            >
              {autoTagState === "running" ? "Reading photo…" : "✨ Auto-tag"}
            </button>
            {autoTagState === "running" && (
              <div className="flex-1 min-w-[10rem]">
                <ProgressBar value={autoTagProgress} label="Reading photo…" />
              </div>
            )}
            {autoTagState !== "running" && autoTagMessage && (
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
            onChange={(e) => { setCategory(e.target.value); setSubType(""); }}
          >
            {/* Three vocabularies, one Item.category column. Beauty
                wins over Spicy when both flags are on (since shade /
                finish are the more constraining attribute set);
                Spicy wins over the main 14; otherwise the main list.
                Beauty uses <optgroup> so the ~30-item list reads as
                six logical sections (Lips / Eyes / Face / Skincare
                / Tools / Fragrance). */}
            {isBeauty
              ? BEAUTY_CATEGORY_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))
              : (isBackroom ? SPICY_CATEGORIES : CATEGORIES).map((c) => (
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
          <textarea
            className="input min-h-[64px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Material, fit notes, where you got it…"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
          Mark as favorite
        </label>

        {/* 🌶 flag — sends this item to the dedicated 🌶 page and
            excludes it from the main closet, outfit builder,
            collection picker, and AI prompts. */}
        <label
          className="flex items-center gap-2 text-sm text-stone-700"
          title="Move to the 🌶 page; hide from the main closet, outfits, collections, and AI prompts."
        >
          <input
            type="checkbox"
            checked={isBackroom}
            onChange={(e) => {
              const next = e.target.checked;
              setIsBackroom(next);
              // Toggling buckets switches the category vocabulary.
              // If the current pick isn't in the new list, snap to
              // the first option so the dropdown's selection lines
              // up with what's actually selectable.
              const list: readonly string[] = next ? SPICY_CATEGORIES : CATEGORIES;
              if (!list.includes(category)) {
                setCategory(list[0]);
                setSubType("");
              }
            }}
          />
          🌶
        </label>

        {/* 💄 flag — sends this item to /wardrobe/beauty and swaps
            the form into beauty mode (BEAUTY_CATEGORIES dropdown,
            shade + finish fields below, barcode scan shortcut). */}
        <label
          className="flex items-center gap-2 text-sm text-stone-700"
          title="Move to the 💄 page; swap to beauty categories with shade fields."
        >
          <input
            type="checkbox"
            checked={isBeauty}
            onChange={(e) => {
              const next = e.target.checked;
              setIsBeauty(next);
              // Snap category to a value that's selectable in the
              // new vocabulary so the dropdown doesn't sit on a
              // value that's not a current option.
              if (next) {
                const beautyList: readonly string[] = BEAUTY_CATEGORIES;
                if (!beautyList.includes(category)) {
                  setCategory("Lipstick");
                  setSubType("");
                }
              } else {
                const fallbackList: readonly string[] = isBackroom ? SPICY_CATEGORIES : CATEGORIES;
                if (!fallbackList.includes(category)) {
                  setCategory(fallbackList[0]);
                  setSubType("");
                }
              }
            }}
          />
          💄
        </label>

        {/* Beauty-only fields. Shade name + hex picker live in a
            single row; the hex input doubles as a swatch preview
            (browsers show a color picker). Finish is a free-text
            input with a <datalist> of common values. */}
        {isBeauty && (
          <div className="space-y-3 rounded-xl bg-blush-50/50 p-3 ring-1 ring-blush-100">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                disabled={barcodeBusy}
                className="btn-secondary text-xs"
              >
                {barcodeBusy ? "Looking up…" : "📷 Scan barcode"}
              </button>
              <span className="text-xs text-stone-500">
                Looks the product up via Open Beauty Facts (or AI fallback) and pre-fills name, brand, category.
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="shadeName">Shade name</label>
                <input
                  id="shadeName"
                  type="text"
                  value={shadeName}
                  onChange={(e) => setShadeName(e.target.value)}
                  placeholder="e.g. Ruby Woo"
                  className="input"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="label" htmlFor="shadeHex">Shade color</label>
                <div className="flex items-center gap-2">
                  <input
                    id="shadeHex"
                    type="color"
                    value={shadeHex || "#a82c52"}
                    onChange={(e) => setShadeHex(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
                    aria-label="Shade color picker"
                  />
                  <input
                    type="text"
                    value={shadeHex}
                    onChange={(e) => setShadeHex(e.target.value)}
                    placeholder="#a82c52"
                    className="input flex-1 font-mono text-xs"
                    maxLength={7}
                  />
                  {shadeHex && (
                    <button
                      type="button"
                      onClick={() => setShadeHex("")}
                      className="text-xs text-stone-400 hover:text-blush-600"
                      aria-label="Clear shade color"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="finish">Finish</label>
              <input
                id="finish"
                type="text"
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                placeholder="matte / satin / gloss / shimmer …"
                className="input"
                list="finish-suggestions"
                maxLength={60}
              />
              <datalist id="finish-suggestions">
                {FINISH_SUGGESTIONS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          </div>
        )}
      </div>

      {/* Barcode scanner sheet — only mounted when open so the
          camera permission isn't requested on idle. The reusable
          BarcodeScanner handles capture; we POST the code to
          /api/barcode-lookup and pre-fill matched fields. */}
      <BarcodeScanner
        open={scannerOpen}
        onCancel={() => setScannerOpen(false)}
        onDetect={async (code) => {
          setScannerOpen(false);
          setBarcodeBusy(true);
          try {
            const r = await fetch("/api/barcode-lookup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code }),
            });
            const data = (await r.json().catch(() => ({}))) as {
              ok?: boolean;
              source?: string;
              match?: {
                name?: string | null;
                brand?: string | null;
                category?: string | null;
                shadeName?: string | null;
              } | null;
              error?: string;
            };
            if (!data.ok) {
              toast(data.error ?? "Barcode lookup failed.", "error");
              return;
            }
            if (!data.match) {
              toast(`No match for ${code}. Fill in by hand.`, "info");
              return;
            }
            // Soft-fill: only overwrite empty fields so the user's
            // already-typed values aren't lost.
            const m = data.match;
            if (m.name && !subType) setSubType(m.name.slice(0, 80));
            if (m.brand && !brand) setBrand(m.brand);
            if (m.category && (BEAUTY_CATEGORIES as readonly string[]).includes(m.category)) {
              setCategory(m.category);
            }
            if (m.shadeName && !shadeName) setShadeName(m.shadeName);
            const fromLabel = data.source === "open-beauty-facts" ? "Open Beauty Facts" : "AI";
            toast(`Pre-filled from ${fromLabel}.`);
          } catch (err) {
            console.error(err);
            toast("Couldn't reach the lookup service.", "error");
          } finally {
            setBarcodeBusy(false);
          }
        }}
      />

      {/* Label / tag photo */}
      <div className="card p-4">
        <p className="label mb-2">Label / tag photo <span className="normal-case font-normal text-stone-400">(optional)</span></p>
        <p className="text-xs text-stone-500 mb-3">Snap the brand, size, or care tag so you can reference it later.</p>
        {labelUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={labelUrl} alt="Label photo" className="mb-3 max-h-48 w-auto rounded-xl bg-cream-50 object-contain p-1 ring-1 ring-stone-100" />
        )}
        <input
          ref={labelFileRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={onPickLabelPhoto}
          className="hidden"
          aria-label="Choose tag photo from library"
        />
        <input
          ref={labelCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickLabelPhoto}
          className="hidden"
          aria-label="Take tag photo with camera"
        />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => labelFileRef.current?.click()}>
            🖼️ Choose from library
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => labelCameraRef.current?.click()}>
            📷 Take photo
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

    </form>

    {/* Post-save "you might already own this" prompt. Renders as a
        fixed-position modal over the form so the user can see what
        they just saved and what it looks like vs the existing one. */}
    {similarMatches && pendingItemId && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Looks similar to items already in your closet"
        className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-sm sm:items-center"
      >
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-100">
          <div className="px-5 pt-5">
            <h2 className="font-display text-xl text-stone-800">
              Already in your closet?
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              The photo you just added looks{" "}
              {similarMatches.length === 1 ? "like this piece" : "similar to these pieces"} you
              already own. Want to remove the new one or keep both?
            </p>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 px-5 sm:grid-cols-2">
            {similarMatches.map((m) => {
              const src = m.imageBgRemovedPath
                ? `/api/uploads/${m.imageBgRemovedPath}`
                : `/api/uploads/${m.imagePath}`;
              const heading = m.subType ?? m.category;
              const subhead = [m.color, m.brand].filter(Boolean).join(" · ");
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-xl bg-cream-50 p-2 ring-1 ring-stone-100"
                >
                  <div className="tile-bg flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={heading} className="h-full w-full object-contain p-1" />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate font-medium text-stone-800">{heading}</p>
                    {subhead && <p className="truncate text-stone-500">{subhead}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={similarBusy}
                    onClick={() => similarRemoveAndGoToMatch(m.id)}
                    className="btn-secondary shrink-0 text-xs"
                    title="Remove the new upload, keep this one"
                  >
                    Use this one
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5 pt-4">
            <button
              type="button"
              disabled={similarBusy}
              onClick={similarKeepBoth}
              className="btn-primary"
            >
              Keep both
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
