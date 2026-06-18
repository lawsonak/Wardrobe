"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ACTIVITIES, SEASONS, csvToList } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { confirmDialog } from "@/components/ConfirmDialog";
import ItemPicker, { type Selectable } from "./ItemPicker";
import CollectionShop from "./CollectionShop";
import CollectionShopItems, { type ShopItem } from "./CollectionShopItems";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

export type CollectionData = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  occasion: string | null;
  season: string | null;
  activities: string;
  itemIds: string[];
};

type Kind = "trip" | "general";

// Edit-mode editor for an existing collection. The wizard handles the
// create flow; this is the screen you see when you open a collection
// to tweak it. AI buttons are side-actions, not the primary path.
export default function CollectionEditor({
  collection,
  items,
  shopItems,
  includeBackroom = false,
}: {
  collection: CollectionData;
  items: Selectable[];
  /** Products pulled from pasted links, saved on this collection.
   *  Managed independently of the metadata form (adds/removes persist
   *  immediately), so it's not part of the unsaved-changes guard. */
  shopItems: ShopItem[];
  /** Mirrors the picker's URL-level Backroom toggle. When true, the
   *  "Re-build packing list with AI" call is allowed to consider
   *  Backroom items. */
  includeBackroom?: boolean;
}) {
  const router = useRouter();

  const [kind, setKind] = useState<Kind>(collection.kind === "trip" ? "trip" : "general");
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? "");
  const [destination, setDestination] = useState(collection.destination ?? "");
  const [startDate, setStartDate] = useState(collection.startDate ?? "");
  const [endDate, setEndDate] = useState(collection.endDate ?? "");
  const [notes, setNotes] = useState(collection.notes ?? "");
  const [occasion, setOccasion] = useState(collection.occasion ?? "");
  const [season, setSeason] = useState(collection.season ?? "");
  const [activities, setActivities] = useState<string[]>(csvToList(collection.activities));
  const [activityDraft, setActivityDraft] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set(collection.itemIds));
  // Lifted shop-items state so the AI shop panel and the paste-links
  // list share one source of truth. Adds/removes still persist
  // server-side via /api/collections/[id]/shop-items; this is purely
  // the in-memory mirror.
  const [shopItemsList, setShopItemsList] = useState(shopItems);
  // Opening a saved collection should feel like *viewing* a trip, not
  // landing on a search page. Both heavy edit surfaces — the metadata
  // form and the closet-wide ItemPicker — collapse by default, so the
  // user sees a clean "here's my Lisbon trip" overview. Tapping either
  // toggle flips back to the editing affordances.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warn before discarding edits — every field compared against the
  // collection as loaded; selected items compared as a sorted id set.
  const editorDirty =
    !busy &&
    (kind !== (collection.kind === "trip" ? "trip" : "general") ||
      name !== collection.name ||
      description !== (collection.description ?? "") ||
      destination !== (collection.destination ?? "") ||
      startDate !== (collection.startDate ?? "") ||
      endDate !== (collection.endDate ?? "") ||
      notes !== (collection.notes ?? "") ||
      occasion !== (collection.occasion ?? "") ||
      season !== (collection.season ?? "") ||
      [...activities].sort().join(",") !==
        csvToList(collection.activities).sort().join(",") ||
      [...selected].sort().join(",") !==
        [...collection.itemIds].sort().join(","));
  useUnsavedChanges(editorDirty);

  const [aiBusy, setAiBusy] = useState<"acts" | "pack" | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [packingNotes, setPackingNotes] = useState<string | null>(null);

  function toggleActivity(a: string) {
    setActivities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  function addCustomActivity() {
    const v = activityDraft.trim();
    if (!v) return;
    if (!activities.includes(v)) setActivities((p) => [...p, v]);
    setActivityDraft("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function suggestActivities() {
    setAiBusy("acts");
    setAiHint(null);
    try {
      const res = await fetch("/api/ai/suggest-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: destination || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          occasion: occasion || undefined,
        }),
      });
      const d = (await res.json()) as { enabled?: boolean; activities?: string[]; message?: string };
      if (!d.enabled) {
        setAiHint(d.message ?? "AI is disabled.");
        return;
      }
      const incoming = (d.activities ?? []).map((s) => s.trim()).filter(Boolean);
      setActivities((prev) => {
        const set = new Set(prev);
        for (const a of incoming) set.add(a);
        return [...set];
      });
    } catch {
      setAiHint("Couldn't reach the AI service.");
    } finally {
      setAiBusy(null);
    }
  }

  async function regeneratePackingList() {
    setAiBusy("pack");
    setAiHint(null);
    try {
      const res = await fetch("/api/ai/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: destination || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          occasion: occasion || undefined,
          notes: notes || undefined,
          activities,
          includeBackroom,
        }),
      });
      const d = (await res.json()) as {
        enabled?: boolean;
        itemIds?: string[];
        reasoning?: string;
        packingNotes?: string;
        message?: string;
      };
      if (!d.enabled) {
        setAiHint(d.message ?? "AI is disabled.");
        return;
      }
      const ids = d.itemIds ?? [];
      setSelected(new Set(ids));
      setReasoning(d.reasoning ?? null);
      setPackingNotes(d.packingNotes ?? null);
      if (ids.length === 0) setAiHint("AI returned no picks.");
    } catch {
      setAiHint("Couldn't reach the AI service.");
    } finally {
      setAiBusy(null);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the collection a name first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          description,
          destination,
          startDate: startDate || null,
          endDate: endDate || null,
          notes,
          occasion,
          season,
          activities,
          itemIds: [...selected],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push(`/collections/${collection.id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't save the collection.");
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete "${collection.name}"?`,
      body: "The pieces inside stay in your closet — only the collection is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    router.push("/collections");
    router.refresh();
  }

  // Collapsed default view: show the activity chips as small read-only
  // badges (no toggle behaviour) plus an "Edit details" affordance.
  // Destination, dates, and name already render in the page header
  // above this component, so the user always sees their trip basics.
  const collapsedSummary = (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
        {activities.length > 0 ? (
          activities.map((a) => (
            <span
              key={a}
              className="rounded-full bg-cream-50 px-2 py-0.5 text-stone-700"
            >
              {capitalize(a)}
            </span>
          ))
        ) : (
          <span className="text-stone-400">No activities set</span>
        )}
      </div>
      <button
        type="button"
        className="btn-ghost text-xs text-blush-600"
        onClick={() => setDetailsOpen(true)}
      >
        ✏️ Edit details
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {!detailsOpen && collapsedSummary}
      {detailsOpen && (
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <KindToggle current={kind} value="trip" label="✈️ Trip" onPick={setKind} />
            <KindToggle current={kind} value="general" label="🧺 General set" onPick={setKind} />
          </div>
          <button
            type="button"
            className="btn-ghost text-xs text-stone-500"
            onClick={() => setDetailsOpen(false)}
          >
            ✕ Done editing
          </button>
        </div>

        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lisbon · May 5–10" />
        </div>

        {kind === "trip" ? (
          <>
            <div>
              <label className="label">Destination</label>
              <input
                className="input"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Lisbon, Portugal"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Start</label>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="label">End</label>
                <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Occasion</label>
              <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="e.g. Date night, Work week" />
            </div>
            <div>
              <label className="label">Season</label>
              <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
                <option value="">Any</option>
                {SEASONS.map((s) => (
                  <option key={s} value={s}>{capitalize(s)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div>
          <span className="label">Activities</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ACTIVITIES.map((a) => (
              <Chip key={a} label={capitalize(a)} on={activities.includes(a)} onClick={() => toggleActivity(a)} />
            ))}
            {activities
              .filter((a) => !ACTIVITIES.includes(a as never))
              .map((a) => (
                <Chip key={a} label={a} on onClick={() => toggleActivity(a)} />
              ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input flex-1"
              value={activityDraft}
              onChange={(e) => setActivityDraft(e.target.value)}
              placeholder="Add custom (e.g. wine tasting)"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomActivity();
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={addCustomActivity}>Add</button>
            <button
              type="button"
              className="btn-ghost text-blush-600"
              onClick={suggestActivities}
              disabled={aiBusy !== null}
            >
              {aiBusy === "acts" ? "Asking AI…" : "✨ Suggest"}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            className="input min-h-[60px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to remember while packing"
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {aiHint && <p className="text-xs text-stone-500">{aiHint}</p>}
      </div>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl text-stone-800">Pieces</h2>
            <span className="text-xs text-stone-500">{selected.size} selected</span>
          </div>
          <button
            type="button"
            className="btn-ghost text-blush-600"
            onClick={regeneratePackingList}
            disabled={aiBusy !== null}
          >
            {aiBusy === "pack" ? "Curating…" : "✨ Regenerate with AI"}
          </button>
        </div>

        {reasoning && (
          <p className="mb-2 rounded-2xl bg-cream-50 px-3 py-2 text-sm text-stone-700">{reasoning}</p>
        )}
        {packingNotes && (
          <p className="mb-2 rounded-2xl bg-blush-50 px-3 py-2 text-sm text-blush-800">💡 {packingNotes}</p>
        )}

        {/* Default view: just the picked items, with per-tile ✕ to drop
            one. The full closet picker only appears when the user taps
            "+ Add or remove pieces" — opening a saved trip shouldn't
            land you in a wardrobe-wide search by default. Matches the
            wizard's pickerOpen pattern. */}
        <div className="card space-y-3 p-3">
          {selected.size === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-stone-500">
              No pieces yet.{" "}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="text-blush-600 hover:underline"
              >
                Add some from your closet.
              </button>
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {items
                .filter((it) => selected.has(it.id))
                .map((it) => {
                  const src = it.imageBgRemovedPath
                    ? `/api/uploads/${it.imageBgRemovedPath}`
                    : `/api/uploads/${it.imagePath}`;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => toggle(it.id)}
                        className="tile-bg group relative block aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-stone-100"
                        title="Remove from this collection"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={it.subType ?? it.category}
                          className="h-full w-full object-contain p-2"
                        />
                        <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-stone-800/80 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
                          ×
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-ghost text-xs text-blush-600"
              onClick={() => setPickerOpen((v) => !v)}
            >
              {pickerOpen ? "Hide picker" : "+ Add or remove pieces"}
            </button>
          </div>
          {pickerOpen && (
            <div className="rounded-2xl bg-stone-50 p-3">
              <ItemPicker items={items} selected={selected} onToggle={toggle} />
            </div>
          )}
        </div>
      </section>

      <CollectionShopItems
        collectionId={collection.id}
        items={shopItemsList}
        setItems={setShopItemsList}
      />

      <CollectionShop
        collectionId={collection.id}
        kind={kind}
        destination={destination || null}
        hasDates={!!startDate}
        startDate={startDate || null}
        endDate={endDate || null}
        activities={activities}
        onItemAdded={(item) => setShopItemsList((prev) => [item, ...prev])}
      />

      {error && <p className="text-sm text-blush-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} className="btn-primary flex-1" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={remove} className="btn-ghost text-blush-600" disabled={busy}>
          Delete
        </button>
        <Link href="/collections" className="btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}

function KindToggle({
  current,
  value,
  label,
  onPick,
}: {
  current: Kind;
  value: Kind;
  label: string;
  onPick: (k: Kind) => void;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition",
        on ? "border-blush-500 bg-blush-50 text-blush-800" : "border-stone-200 text-stone-600 hover:border-stone-300",
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition",
        on ? "border-blush-500 bg-blush-50 text-blush-800" : "border-stone-200 text-stone-600 hover:border-stone-300",
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
