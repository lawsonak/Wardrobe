"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LOOK_SLOTS, type LookSlot } from "@/lib/constants";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// 15-slot picker for assembling or editing a Look. Mirrors the
// OutfitBuilder pattern but for beauty: each slot maps to a single
// LOOK_SLOTS string (Lipstick, Mascara, …) and the user picks one
// matching item per slot. Items are pre-filtered server-side to
// isBeauty=true and grouped by the same category-string-equals-slot
// rule used for outfits, so the Mascara slot only shows Mascara
// items.
//
// Empty slots are allowed — a Look needs ≥1 product overall, not
// one of each. The Save button is disabled until that minimum is met.

export type PickableItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
  shadeName: string | null;
  shadeHex: string | null;
};

export type InitialLook = {
  id: string;
  name: string;
  notes: string | null;
  items: Array<{ itemId: string; slot: string }>;
};

export default function LookBuilder({
  items,
  initial,
}: {
  items: PickableItem[];
  initial?: InitialLook;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // `picks` maps slot → itemId. An empty string means the slot is
  // unfilled. Initialised from `initial` when editing.
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    for (const slot of LOOK_SLOTS) base[slot] = "";
    if (initial) {
      for (const it of initial.items) {
        if ((LOOK_SLOTS as readonly string[]).includes(it.slot)) {
          base[it.slot] = it.itemId;
        }
      }
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  // Which slot's picker sheet is open. Null = none. Tap a slot to
  // open it; tap an item inside the sheet to set the slot.
  const [openSlot, setOpenSlot] = useState<LookSlot | null>(null);

  // Bucket items by the slot they fit (category string match). Built
  // once; the picker reads from this map.
  const itemsBySlot = useMemo(() => {
    const m: Record<string, PickableItem[]> = {};
    for (const slot of LOOK_SLOTS) m[slot] = [];
    for (const it of items) {
      if ((LOOK_SLOTS as readonly string[]).includes(it.category)) {
        m[it.category].push(it);
      }
    }
    return m;
  }, [items]);
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const filledCount = useMemo(
    () => Object.values(picks).filter((v) => !!v).length,
    [picks],
  );

  async function save() {
    if (busy) return;
    const payloadItems = Object.entries(picks)
      .filter(([, itemId]) => !!itemId)
      .map(([slot, itemId]) => ({ slot, itemId }));
    if (payloadItems.length === 0) {
      toast("Add at least one product before saving.", "error");
      return;
    }
    setBusy(true);
    try {
      const editing = !!initial;
      const url = editing ? `/api/looks/${initial!.id}` : "/api/looks";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Untitled look",
          notes: notes.trim() || null,
          items: payloadItems,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? `Couldn't save (HTTP ${res.status})`, "error");
        return;
      }
      toast(editing ? "Look updated." : "Look saved.");
      // Navigate to detail on create, refresh on edit so any
      // collage thumbs repaint with the new product set.
      if (editing) {
        router.refresh();
      } else {
        const id = (data as { look?: { id?: string } })?.look?.id;
        if (id) router.push(`/looks/${id}`);
        else router.push("/looks");
      }
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    const ok = await confirmDialog({
      title: `Delete "${initial.name}"?`,
      body: "This can't be undone. Outfits paired with this look will lose the pairing but keep their clothing pieces.",
      confirmText: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/looks/${initial.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body?.error ?? `Couldn't delete (HTTP ${res.status})`, "error");
        return;
      }
      toast("Look deleted.");
      router.push("/looks");
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="look-name">Name</label>
          <input
            id="look-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Everyday face, Date night smoky"
            className="input"
            maxLength={120}
          />
        </div>
        <div>
          <label className="label" htmlFor="look-notes">Notes</label>
          <textarea
            id="look-notes"
            className="input min-h-[64px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Application notes, occasion, etc. (optional)"
            maxLength={1000}
          />
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <p className="text-xs uppercase tracking-wide text-stone-500">
          Products · {filledCount} filled / {LOOK_SLOTS.length} slots
        </p>
        <p className="text-xs text-stone-500">
          Tap a slot to pick a product. Slots are optional — leave the
          ones you don&rsquo;t use empty.
        </p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {LOOK_SLOTS.map((slot) => {
            const pickedId = picks[slot];
            const picked = pickedId ? itemById.get(pickedId) : undefined;
            const available = itemsBySlot[slot] ?? [];
            const hasOptions = available.length > 0;
            return (
              <li key={slot}>
                <button
                  type="button"
                  onClick={() => hasOptions && setOpenSlot(slot)}
                  disabled={!hasOptions}
                  className={
                    "relative block w-full overflow-hidden rounded-xl ring-1 ring-stone-200 disabled:opacity-40 " +
                    (picked ? "ring-blush-300" : "hover:ring-blush-200")
                  }
                  title={hasOptions ? `${slot} — ${available.length} available` : `${slot} (no products)`}
                >
                  <div className="tile-bg flex aspect-square items-center justify-center p-1">
                    {picked ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          picked.imageBgRemovedPath
                            ? `/api/uploads/${picked.imageBgRemovedPath}`
                            : `/api/uploads/${picked.imagePath}`
                        }
                        alt={picked.subType ?? picked.category}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-3xl opacity-30">+</span>
                    )}
                  </div>
                  <div className="space-y-0.5 px-2 py-1 text-left">
                    <p className="text-[11px] font-medium text-stone-700">{slot}</p>
                    {picked?.shadeName ? (
                      <p className="flex items-center gap-1 truncate text-[10px] text-stone-500">
                        {picked.shadeHex && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white"
                            style={{ backgroundColor: picked.shadeHex }}
                          />
                        )}
                        {picked.shadeName}
                      </p>
                    ) : (
                      <p className="text-[10px] text-stone-400">
                        {hasOptions ? `${available.length} available` : "(none)"}
                      </p>
                    )}
                  </div>
                  {picked && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPicks((p) => ({ ...p, [slot]: "" }));
                      }}
                      aria-label={`Clear ${slot}`}
                      className="absolute -right-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-white text-stone-500 shadow-card ring-1 ring-stone-200 hover:text-blush-600"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Slot picker sheet — lists every isBeauty item whose category
          matches the open slot. Tap one to fill the slot; backdrop
          tap cancels. */}
      {openSlot && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenSlot(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card max-h-[80vh] w-full max-w-md space-y-3 overflow-y-auto p-4"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-stone-800">Pick {openSlot}</h2>
              <button
                type="button"
                onClick={() => setOpenSlot(null)}
                className="text-xs text-stone-500 hover:text-blush-600"
              >
                Cancel
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {(itemsBySlot[openSlot] ?? []).map((it) => {
                const isPicked = picks[openSlot] === it.id;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicks((p) => ({ ...p, [openSlot]: it.id }));
                        setOpenSlot(null);
                      }}
                      className={
                        "group relative block w-full overflow-hidden rounded-xl ring-1 ring-stone-200 " +
                        (isPicked ? "ring-2 ring-blush-500" : "hover:ring-blush-200")
                      }
                    >
                      <div className="tile-bg flex aspect-square items-center justify-center p-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={
                            it.imageBgRemovedPath
                              ? `/api/uploads/${it.imageBgRemovedPath}`
                              : `/api/uploads/${it.imagePath}`
                          }
                          alt={it.subType ?? it.category}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="space-y-0.5 px-2 py-1 text-left text-[10px] text-stone-600">
                        <p className="truncate font-medium text-stone-700">{it.subType ?? it.category}</p>
                        {it.shadeName && (
                          <p className="flex items-center gap-1 truncate">
                            {it.shadeHex && (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white"
                                style={{ backgroundColor: it.shadeHex }}
                              />
                            )}
                            {it.shadeName}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Sticky bottom action bar. Save is disabled until ≥1 slot
          filled. Delete only shown in edit mode. */}
      <div className="card sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-2 p-3 sm:bottom-4">
        <p className="text-xs text-stone-500">
          {filledCount === 0 ? "Pick at least one product to save." : `${filledCount} product${filledCount === 1 ? "" : "s"}`}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/looks" className="btn-ghost text-stone-500">Cancel</Link>
          {initial && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="btn-ghost text-blush-600"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || filledCount === 0}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? "Saving…" : initial ? "Save changes" : "Save look"}
          </button>
        </div>
      </div>
    </div>
  );
}
