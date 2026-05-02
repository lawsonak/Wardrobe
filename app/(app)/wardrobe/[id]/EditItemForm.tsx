"use client";

import { useEffect, useState } from "react";
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
import { parse as parsePendingAi } from "@/lib/pendingAi";
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
  /** JSON blob of AI suggestions staged from a bulk re-tag run that
   *  the user hasn't reviewed yet. The form auto-opens the review
   *  panel when this is non-null. */
  pendingAiSuggestions: string | null;
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
  const [autoTagState, setAutoTagState] = useState<"idle" | "running" | "pending" | "done" | "disabled" | "error">("idle");
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);
  // When the auto-tag call returns suggestions for ALREADY-SET fields,
  // we don't apply them silently — the user reviews a clear current →
  // suggested diff first and ticks which ones to accept. Empty fields
  // default to checked (the AI is filling a gap); changes to set
  // fields default to unchecked (preserve what the user typed unless
  // they explicitly opt in). Notes are still append-only — they
  // never conflict and stay outside this review.
  type AutoTagChange =
    | {
        kind: "new" | "change";
        field: "category" | "subType" | "color" | "brand" | "size";
        label: string;
        currentDisplay: string;
        suggestedDisplay: string;
        suggestedValue: string;
      }
    | {
        kind: "new" | "change";
        field: "seasons" | "activities";
        label: string;
        currentDisplay: string;
        suggestedDisplay: string;
        suggestedValue: string[];
      }
    | {
        kind: "new" | "change";
        field: "material";
        label: string;
        currentDisplay: string;
        suggestedDisplay: string;
        suggestedValue: string;
      };
  const [autoTagChanges, setAutoTagChanges] = useState<AutoTagChange[] | null>(null);
  const [autoTagAccept, setAutoTagAccept] = useState<Record<string, boolean>>({});
  const autoTagProgress = useTimedProgress(autoTagState === "running", 18);

  // If a bulk re-tag run staged AI suggestions for this item that
  // would have overwritten an already-set field, the row was saved
  // with `pendingAiSuggestions`. On mount, parse + filter against
  // the current values (the user may have edited the field since)
  // and pre-populate the review panel.
  useEffect(() => {
    const pending = parsePendingAi(item.pendingAiSuggestions);
    if (!pending) return;
    const changes: AutoTagChange[] = [];
    if (pending.category && CATEGORIES.includes(pending.category) && pending.category !== category) {
      changes.push({
        kind: category ? "change" : "new",
        field: "category",
        label: "Category",
        currentDisplay: category || "(not set)",
        suggestedDisplay: pending.category,
        suggestedValue: pending.category,
      });
    }
    if (pending.subType && pending.subType.trim() !== subType.trim()) {
      changes.push({
        kind: subType ? "change" : "new",
        field: "subType",
        label: "Sub-type",
        currentDisplay: subType || "(not set)",
        suggestedDisplay: pending.subType,
        suggestedValue: pending.subType,
      });
    }
    if (pending.color && pending.color !== color) {
      changes.push({
        kind: color ? "change" : "new",
        field: "color",
        label: "Color",
        currentDisplay: color || "(not set)",
        suggestedDisplay: pending.color,
        suggestedValue: pending.color,
      });
    }
    if (pending.brand && pending.brand.trim() !== (brand ?? "").trim()) {
      changes.push({
        kind: brand ? "change" : "new",
        field: "brand",
        label: "Brand",
        currentDisplay: brand || "(not set)",
        suggestedDisplay: pending.brand,
        suggestedValue: pending.brand,
      });
    }
    if (pending.size && pending.size.trim() !== (size ?? "").trim()) {
      changes.push({
        kind: size ? "change" : "new",
        field: "size",
        label: "Size",
        currentDisplay: size || "(not set)",
        suggestedDisplay: pending.size,
        suggestedValue: pending.size,
      });
    }
    if (pending.seasons) {
      const cur = [...seasons].sort().join(",");
      const sug = [...pending.seasons].sort().join(",");
      if (cur !== sug) {
        changes.push({
          kind: seasons.length === 0 ? "new" : "change",
          field: "seasons",
          label: "Seasons",
          currentDisplay: seasons.length > 0 ? seasons.join(", ") : "(not set)",
          suggestedDisplay: pending.seasons.join(", "),
          suggestedValue: pending.seasons,
        });
      }
    }
    if (pending.activities) {
      const cur = [...activities].sort().join(",");
      const sug = [...pending.activities].sort().join(",");
      if (cur !== sug) {
        changes.push({
          kind: activities.length === 0 ? "new" : "change",
          field: "activities",
          label: "Activities",
          currentDisplay: activities.length > 0 ? activities.join(", ") : "(not set)",
          suggestedDisplay: pending.activities.join(", "),
          suggestedValue: pending.activities,
        });
      }
    }
    if (pending.material) {
      const matLine = `Material: ${pending.material}`;
      const existingMat = extractFitNotesLine(fitNotes, "material:");
      if (existingMat !== pending.material) {
        changes.push({
          kind: existingMat ? "change" : "new",
          field: "material",
          label: "Material",
          currentDisplay: existingMat || "(not in fit notes)",
          suggestedDisplay: pending.material,
          suggestedValue: matLine,
        });
      }
    }
    if (changes.length === 0) {
      // Pending blob exists but every suggestion is already applied
      // (user matched it manually since the bulk run). Clear the
      // server-side blob so the closet's "Pending AI" filter pill
      // count stays accurate.
      void fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingAiSuggestions: null }),
      });
      return;
    }
    setAutoTagChanges(changes);
    const acceptDefaults: Record<string, boolean> = {};
    // Pre-check every row by default — the user asked for previously-
    // set values to be reconsidered every run, not silently preserved.
    // The change-vs-new distinction stays as a visual badge so it's
    // obvious which fields are getting overwritten, but the user has
    // to actively UNTICK to keep an existing value.
    for (const c of changes) acceptDefaults[c.field] = true;
    setAutoTagAccept(acceptDefaults);
    setAutoTagState("pending");
    setAutoTagMessage(
      `${changes.length} pending AI suggestion${changes.length === 1 ? "" : "s"} from a bulk re-tag.`,
    );
    // We only run this on mount — applying or rejecting clears the
    // server-side blob and we don't want a re-render to repopulate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lookupState, setLookupState] = useState<"idle" | "running" | "pending" | "applied" | "disabled" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [lookupSources, setLookupSources] = useState<string[]>([]);
  const [lookupCandidate, setLookupCandidate] = useState<{
    material?: string;
    careNotes?: string;
    description?: string;
    retailPrice?: string;
    productUrl?: string;
  } | null>(null);
  // URL the user pastes for the direct-fetch path. Independent from
  // brand search above — both share the lookupCandidate review state.
  const [lookupUrl, setLookupUrl] = useState("");
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

  // Single AI button.
  //
  // Sequence: notes call first (free-form prose that's good at
  // describing fabric, neckline, fit, pattern), then the structured
  // tag call with the notes string passed as `notesContext`. The
  // tagger uses the notes as ground truth to commit to enum values
  // it would otherwise hedge to null on. ~5s slower than running in
  // parallel but visibly higher commit-rate on borderline shots.
  async function autoTag() {
    if (autoTagState === "running") return;
    setAutoTagState("running");
    setAutoTagMessage(null);
    try {
      const photos = await loadPhotos();

      // ---- Notes first ----
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

      const notesSettled = await Promise.allSettled([
        fetchWithRetry("/api/ai/notes", { method: "POST", body: notesFd }, { timeoutMs: 60_000 }),
      ]).then((r) => r[0]);

      let generatedNotes: string = "";
      if (notesSettled.status === "fulfilled" && notesSettled.value.ok) {
        const data = await notesSettled.value.json().catch(() => ({}));
        if (data?.enabled !== false) {
          generatedNotes = String(data?.notes ?? "").trim();
        }
      }

      // ---- Structured tag, with notes as context ----
      const tagFd = new FormData();
      tagFd.append("image", photos.image);
      if (photos.label) tagFd.append("labelImage", photos.label);
      if (generatedNotes) tagFd.append("notesContext", generatedNotes);

      const tagSettled = await Promise.allSettled([
        fetchWithRetry("/api/ai/tag", { method: "POST", body: tagFd }, { timeoutMs: 60_000 }),
      ]).then((r) => r[0]);

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

          // Build a list of proposed changes. Each entry knows whether
          // the current field is empty ("new") or differs ("change"),
          // and renders a clear current → suggested diff. Default
          // accept state: ON for "new" rows, OFF for "change" rows so
          // the user has to opt in to overwrite anything they typed.
          const changes: AutoTagChange[] = [];
          if (s.category && CATEGORIES.includes(s.category) && s.category !== category) {
            changes.push({
              kind: category ? "change" : "new",
              field: "category",
              label: "Category",
              currentDisplay: category || "(not set)",
              suggestedDisplay: s.category,
              suggestedValue: s.category,
            });
          }
          if (s.subType && s.subType.trim() && s.subType.trim() !== subType.trim()) {
            changes.push({
              kind: subType ? "change" : "new",
              field: "subType",
              label: "Sub-type",
              currentDisplay: subType || "(not set)",
              suggestedDisplay: s.subType,
              suggestedValue: s.subType,
            });
          }
          if (s.color && s.color !== color) {
            changes.push({
              kind: color ? "change" : "new",
              field: "color",
              label: "Color",
              currentDisplay: color || "(not set)",
              suggestedDisplay: s.color,
              suggestedValue: s.color,
            });
          }
          if (s.brand && s.brand.trim() && s.brand.trim() !== (brand ?? "").trim()) {
            changes.push({
              kind: brand ? "change" : "new",
              field: "brand",
              label: "Brand",
              currentDisplay: brand || "(not set)",
              suggestedDisplay: s.brand,
              suggestedValue: s.brand,
            });
          }
          if (s.size && s.size.trim() && s.size.trim() !== (size ?? "").trim()) {
            changes.push({
              kind: size ? "change" : "new",
              field: "size",
              label: "Size",
              currentDisplay: size || "(not set)",
              suggestedDisplay: s.size,
              suggestedValue: s.size,
            });
          }
          if (s.seasons) {
            const valid = s.seasons.filter((x) => SEASONS.includes(x as never));
            const cur = [...seasons].sort().join(",");
            const sug = [...valid].sort().join(",");
            if (valid.length > 0 && cur !== sug) {
              changes.push({
                kind: seasons.length === 0 ? "new" : "change",
                field: "seasons",
                label: "Seasons",
                currentDisplay: seasons.length > 0 ? seasons.join(", ") : "(not set)",
                suggestedDisplay: valid.join(", "),
                suggestedValue: valid,
              });
            }
          }
          if (s.activities) {
            const valid = s.activities.filter((x) => ACTIVITIES.includes(x as never));
            const cur = [...activities].sort().join(",");
            const sug = [...valid].sort().join(",");
            if (valid.length > 0 && cur !== sug) {
              changes.push({
                kind: activities.length === 0 ? "new" : "change",
                field: "activities",
                label: "Activities",
                currentDisplay: activities.length > 0 ? activities.join(", ") : "(not set)",
                suggestedDisplay: valid.join(", "),
                suggestedValue: valid,
              });
            }
          }
          if (s.material && s.material.trim()) {
            const matLine = `Material: ${s.material}`;
            if (!fitNotes.toLowerCase().includes("material:")) {
              changes.push({
                kind: fitNotes.trim() ? "new" : "new",
                field: "material",
                label: "Material",
                currentDisplay: "(not in fit notes)",
                suggestedDisplay: s.material,
                suggestedValue: matLine,
              });
            } else if (!fitNotes.includes(matLine)) {
              changes.push({
                kind: "change",
                field: "material",
                label: "Material",
                currentDisplay: extractFitNotesLine(fitNotes, "material:") || "(set differently)",
                suggestedDisplay: s.material,
                suggestedValue: matLine,
              });
            }
          }
          if (changes.length > 0) {
            setAutoTagChanges(changes);
            const acceptDefaults: Record<string, boolean> = {};
            // Pre-check every row — re-tagging existing values by
            // default. See the matching block in the pending-blob
            // mount effect for the full rationale.
            for (const c of changes) acceptDefaults[c.field] = true;
            setAutoTagAccept(acceptDefaults);
            applied = changes.length;
          }
        }
      } else if (tagSettled.status === "rejected") {
        tagError = friendlyFetchError(tagSettled.reason, "Couldn't auto-tag.");
      }

      // ---- Notes ----
      // Already fetched above (we needed the text for notesContext).
      // Just append to the form's notes field if anything came back.
      if (generatedNotes) {
        setNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${generatedNotes}` : generatedNotes));
        notesAdded = true;
      }

      // ---- Combined message ----
      if (disabledMessage) {
        setAutoTagState("disabled");
        setAutoTagMessage(disabledMessage);
        return;
      }

      // Two outcomes:
      //  - There are field-level changes to review → state="pending"
      //    (the panel below shows current → suggested for each, user
      //    approves per-row before any setX() runs).
      //  - Only notes were added (or nothing changed) → state="done".
      if (applied > 0) {
        setAutoTagState("pending");
        setAutoTagMessage(
          `${applied} suggestion${applied === 1 ? "" : "s"} to review${usedLabel ? " (label scanned)" : ""}${notesAdded ? "; notes added below" : ""}.`,
        );
      } else if (notesAdded) {
        setAutoTagState("done");
        setAutoTagMessage("Added notes from the photo. No other field changes.");
      } else if (tagError) {
        setAutoTagState("error");
        setAutoTagMessage(tagError);
      } else if (suggestionKeyCount === 0 && tagRawText) {
        setAutoTagState("error");
        setAutoTagMessage(`Model returned: ${tagRawText.slice(0, 200)}`);
      } else {
        setAutoTagState("done");
        setAutoTagMessage("No new suggestions — current values match what the model saw.");
      }
    } catch (err) {
      console.error(err);
      setAutoTagState("error");
      setAutoTagMessage(friendlyFetchError(err, "Auto-tag failed."));
    }
  }

  // Apply only the rows the user ticked. setX() finally fires here for
  // accepted suggestions; the rest are discarded. Save still requires
  // an explicit "Save changes" click — same pattern as the
  // productLookup flow (pending → applied → save).
  function applyAutoTagChanges() {
    if (!autoTagChanges) return;
    let appliedCount = 0;
    for (const c of autoTagChanges) {
      if (!autoTagAccept[c.field]) continue;
      switch (c.field) {
        case "category":
          setCategory(c.suggestedValue as Category);
          break;
        case "subType":
          setSubType(c.suggestedValue as string);
          break;
        case "color":
          setColor(c.suggestedValue as string);
          break;
        case "brand":
          setBrand(c.suggestedValue as string);
          setBrandId(null);
          break;
        case "size":
          setSize(c.suggestedValue as string);
          break;
        case "seasons":
          setSeasons(c.suggestedValue as string[]);
          break;
        case "activities":
          setActivities(c.suggestedValue as string[]);
          break;
        case "material": {
          const matLine = c.suggestedValue as string;
          // Replace existing "Material:" line if present, otherwise
          // append. Avoids the "Material: cotton\nMaterial: linen"
          // pile-up when the user re-runs auto-tag.
          setFitNotes((prev) => {
            const lines = prev.split(/\r?\n/);
            const idx = lines.findIndex((l) => l.toLowerCase().startsWith("material:"));
            if (idx >= 0) {
              lines[idx] = matLine;
              return lines.join("\n");
            }
            return prev.trim() ? `${prev.trim()}\n${matLine}` : matLine;
          });
          break;
        }
      }
      appliedCount++;
    }
    setAutoTagChanges(null);
    setAutoTagAccept({});
    setAutoTagState("done");
    setAutoTagMessage(
      appliedCount > 0
        ? `Applied ${appliedCount} suggestion${appliedCount === 1 ? "" : "s"} — review and save.`
        : "Rejected all suggestions.",
    );
    // Clear the server-side staged blob so the closet's Pending AI
    // filter no longer flags this item. Best-effort — UI already
    // reflects the user's choice if the network call fails.
    void clearPendingOnServer();
  }

  function rejectAutoTagChanges() {
    setAutoTagChanges(null);
    setAutoTagAccept({});
    setAutoTagState("done");
    setAutoTagMessage("Rejected — your existing values are unchanged.");
    void clearPendingOnServer();
  }

  async function clearPendingOnServer() {
    if (!item.pendingAiSuggestions) return;
    try {
      await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingAiSuggestions: null }),
      });
    } catch {
      /* non-fatal — best effort */
    }
  }

  // Two-step flow shared between the brand-search button and the
  // paste-a-link panel: the API runs the lookup and the result lands
  // in `lookupCandidate` for review. The user clicks the productUrl
  // to verify, then either approves (applyLookup) or dismisses
  // (rejectLookup). Nothing touches the form fields until approval.
  async function runLookup(body: Record<string, unknown>, missingMessage: string) {
    if (lookupState === "running") return;
    setLookupState("running");
    setLookupMessage(null);
    setLookupSources([]);
    setLookupCandidate(null);
    try {
      const res = await fetch("/api/ai/lookup-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      const sources = Array.isArray(data?.sources) ? (data.sources as string[]).slice(0, 5) : [];
      setLookupSources(sources);

      const hasAnything = !!(s.material || s.careNotes || s.description || s.retailPrice || s.productUrl);
      if (!hasAnything) {
        setLookupState("error");
        setLookupMessage(missingMessage);
        return;
      }

      setLookupCandidate(s);
      setLookupState("pending");
      setLookupMessage(null);
    } catch (err) {
      console.error(err);
      setLookupState("error");
      setLookupMessage(friendlyFetchError(err, "Lookup failed."));
    }
  }

  async function lookupOnline() {
    if (!brand.trim()) {
      setLookupState("error");
      setLookupMessage("Add a brand first — that's what we search for online.");
      return;
    }
    return runLookup(
      { brand: brand.trim(), subType: subType || null, color: color || null, category },
      "Couldn't find this product online — try a more specific subType or color.",
    );
  }

  async function lookupByUrl() {
    if (!lookupUrl.trim()) {
      setLookupState("error");
      setLookupMessage("Paste a product URL first.");
      return;
    }
    return runLookup(
      { url: lookupUrl.trim() },
      "Couldn't read that page — try the brand search instead.",
    );
  }

  function applyLookup() {
    if (!lookupCandidate) return;
    const s = lookupCandidate;
    let applied = 0;
    if (s.material) {
      const line = `Material: ${s.material}`;
      if (!fitNotes.toLowerCase().includes("material:")) {
        setFitNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
        applied++;
      }
    }
    if (s.careNotes) {
      const line = `Care: ${s.careNotes}`;
      if (!fitNotes.toLowerCase().includes("care:")) {
        setFitNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
        applied++;
      }
    }
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
    setLookupCandidate(null);
    setLookupState("applied");
    setLookupMessage(
      applied > 0
        ? `Applied ${applied} field${applied === 1 ? "" : "s"} from the web — review and save.`
        : "Everything was already filled in — no changes needed.",
    );
  }

  function rejectLookup() {
    setLookupCandidate(null);
    setLookupState("idle");
    setLookupMessage(null);
    setLookupSources([]);
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
          {/* Direct-fetch path: pasting a URL hits productMeta + a
              narrow text-mode AI call. Faster + more accurate than
              brand search when the user has the actual link. Sits in
              the same button row but expands to a full-width input
              once you type so it doesn't get squished. */}
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={lookupUrl}
            onChange={(e) => setLookupUrl(e.target.value)}
            placeholder="…or paste product link"
            className="input flex-1 min-w-[10rem] text-xs"
            disabled={busy || lookupState === "running" || autoTagState === "running"}
          />
          <button
            type="button"
            onClick={lookupByUrl}
            className="btn-ghost text-xs text-blush-600"
            disabled={busy || lookupState === "running" || autoTagState === "running" || !lookupUrl.trim()}
            title="Pull material, care, retail price directly from the product page"
          >
            ✨ Use link
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

        {/* Auto-tag review panel. Lists every field the AI wants to
            change, shows current → suggested clearly, and defaults
            "new" rows to checked + "change" rows to unchecked so
            existing values are preserved unless the user opts in. */}
        {autoTagState === "pending" && autoTagChanges && autoTagChanges.length > 0 && (
          <div className="rounded-xl bg-blush-50 p-3 ring-1 ring-blush-200">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-blush-800">
                ✨ AI suggestions — untick anything you want to keep as-is
              </p>
              <div className="flex items-center gap-2 text-[11px] text-blush-700">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const c of autoTagChanges) next[c.field] = true;
                    setAutoTagAccept(next);
                  }}
                  className="hover:underline"
                >
                  Select all
                </button>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setAutoTagAccept({})}
                  className="hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {autoTagChanges.map((c) => {
                const checked = !!autoTagAccept[c.field];
                return (
                  <li
                    key={c.field}
                    className="flex items-start gap-3 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-blush-100"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setAutoTagAccept((prev) => ({ ...prev, [c.field]: e.target.checked }))
                      }
                      className="mt-1"
                      aria-label={`Apply ${c.label} suggestion`}
                    />
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-stone-700">{c.label}</span>
                        <span
                          className={
                            "rounded-full px-1.5 py-0.5 text-[10px] " +
                            (c.kind === "new"
                              ? "bg-sage-100 text-sage-700"
                              : "bg-amber-100 text-amber-800")
                          }
                        >
                          {c.kind === "new" ? "new" : "change"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-stone-700">
                        <span className="text-stone-500 line-through decoration-stone-300">
                          {c.currentDisplay}
                        </span>
                        <span aria-hidden className="mx-1 text-stone-400">→</span>
                        <span className="font-medium text-blush-700">{c.suggestedDisplay}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={applyAutoTagChanges}
                className="btn-primary text-xs"
              >
                Apply selected
              </button>
              <button
                type="button"
                onClick={rejectAutoTagChanges}
                className="btn-ghost text-xs text-stone-500"
              >
                Reject all
              </button>
            </div>
          </div>
        )}

        {lookupState === "pending" && lookupCandidate && (
          <div className="rounded-xl bg-blush-50 p-3 ring-1 ring-blush-200">
            <p className="mb-2 text-xs font-medium text-blush-800">
              Is this the right product? Tap the link to verify, then choose.
            </p>
            {lookupCandidate.productUrl ? (
              <a
                href={lookupCandidate.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block break-all text-sm font-medium text-blush-700 underline hover:text-blush-800"
              >
                {hostnameOf(lookupCandidate.productUrl)}
                <span className="text-stone-400"> ↗</span>
              </a>
            ) : (
              <p className="text-xs text-stone-500">No specific product URL — only general sources.</p>
            )}
            {lookupCandidate.description && (
              <p className="mt-2 text-xs italic text-stone-700">&ldquo;{lookupCandidate.description}&rdquo;</p>
            )}
            <ul className="mt-2 space-y-0.5 text-xs text-stone-600">
              {lookupCandidate.material && (
                <li><span className="text-stone-400">Material:</span> {lookupCandidate.material}</li>
              )}
              {lookupCandidate.careNotes && (
                <li><span className="text-stone-400">Care:</span> {lookupCandidate.careNotes}</li>
              )}
              {lookupCandidate.retailPrice && (
                <li><span className="text-stone-400">Retail:</span> {lookupCandidate.retailPrice}</li>
              )}
            </ul>
            {lookupSources.length > 0 && (
              <p className="mt-2 text-xs text-stone-400">
                Other sources:{" "}
                {lookupSources
                  .filter((s) => s !== lookupCandidate.productUrl)
                  .map((s, i) => (
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyLookup}
                className="btn-primary text-xs"
              >
                ✓ Use this — apply details
              </button>
              <button
                type="button"
                onClick={rejectLookup}
                className="btn-ghost text-xs text-stone-500"
              >
                Not it
              </button>
            </div>
          </div>
        )}

        {lookupState === "applied" && lookupSources.length > 0 && (
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

// Pull the value off a "Material: cotton" or "Care: machine wash"
// style line in the fit-notes block so the auto-tag review panel can
// show "current → suggested" without the user having to flip back to
// the form.
function extractFitNotesLine(notes: string, prefix: string): string | null {
  for (const line of notes.split(/\r?\n/)) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith(prefix.toLowerCase())) {
      return line.slice(line.indexOf(":") + 1).trim() || null;
    }
  }
  return null;
}
