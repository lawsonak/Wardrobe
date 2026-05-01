"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

type Candidate = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
};

type Sister = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

// Lets the user pick another item from the closet to link as part of
// a matching set. The smart server-side helper at /api/sets/link
// handles all the cases (create new set, extend existing, etc.) so
// this component just sends two item IDs and refreshes.
export default function SetLink({
  itemId,
  setId,
  setName,
  sisters,
  candidates,
}: {
  itemId: string;
  setId: string | null;
  setName: string | null;
  sisters: Sister[];
  /** Other closet items the user could link this one to. Already
   *  excludes the current item and any current sisters. */
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const blob = `${c.subType ?? ""} ${c.brand ?? ""} ${c.category}`.toLowerCase();
      return blob.includes(q);
    });
  }, [candidates, search]);

  async function linkTo(otherId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sets/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemAId: itemId, itemBId: otherId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      haptic("success");
      toast(setId ? "Added to set" : "Linked");
      setPickerOpen(false);
      setSearch("");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't link", "error");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    const ok = await confirmDialog({
      title: setName ? `Remove from "${setName}"?` : "Remove from set?",
      body: "The item stays in your closet — only the set link is cleared.",
      confirmText: "Unlink",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptic("tap");
      toast("Unlinked");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't unlink", "error");
    } finally {
      setBusy(false);
    }
  }

  // ── Inline picker ──────────────────────────────────────────────
  if (pickerOpen) {
    return (
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="label mb-0">Pick the matching piece</p>
          <button
            type="button"
            onClick={() => { setPickerOpen(false); setSearch(""); }}
            className="text-xs text-stone-400 hover:text-stone-600"
          >
            Cancel
          </button>
        </div>
        <input
          autoFocus
          type="text"
          placeholder="Search closet…"
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search closet"
        />
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-stone-500">
            {candidates.length === 0
              ? "No other items in your closet to link to."
              : "No matches — try clearing the search."}
          </p>
        ) : (
          <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {filtered.map((c) => {
              const src = c.imageBgRemovedPath
                ? `/api/uploads/${c.imageBgRemovedPath}`
                : `/api/uploads/${c.imagePath}`;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => linkTo(c.id)}
                    className={cn(
                      "tile-bg block aspect-square w-full overflow-hidden rounded-xl ring-1 ring-stone-100 transition",
                      "hover:ring-2 hover:ring-blush-300 disabled:opacity-50",
                    )}
                    title={c.subType ?? c.category}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={c.subType ?? c.category}
                      className="h-full w-full object-contain p-1"
                    />
                  </button>
                  <p className="mt-1 truncate px-1 text-[11px] text-stone-500">
                    {c.subType ?? c.category}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  // ── Linked: sisters + add another ──────────────────────────────
  if (setId) {
    return (
      <section className="card p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="label mb-0">Part of a set</p>
            <p className="font-display text-lg text-stone-800">
              {setName ?? "Unnamed set"}
            </p>
          </div>
          <Link href={`/sets/${setId}`} className="text-xs text-blush-600 hover:underline">
            Open set →
          </Link>
        </div>
        {sisters.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {sisters.map((s) => {
              const src = s.imageBgRemovedPath
                ? `/api/uploads/${s.imageBgRemovedPath}`
                : `/api/uploads/${s.imagePath}`;
              return (
                <li key={s.id}>
                  <Link
                    href={`/wardrobe/${s.id}`}
                    className="tile-bg flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg ring-1 ring-stone-100"
                    title={s.subType ?? s.category}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={s.subType ?? s.category} className="h-full w-full object-contain p-1" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-stone-500">
            No other pieces yet. Add one below.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="btn-secondary text-xs"
          >
            + Add another piece
          </button>
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="text-xs text-stone-400 hover:text-blush-600"
          >
            Unlink from set
          </button>
        </div>
      </section>
    );
  }

  // ── Unlinked: + Link CTA ───────────────────────────────────────
  return (
    <section className="card flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="label mb-0">Matching set</p>
        <p className="text-xs text-stone-500">
          Link this piece to its match — swimsuit top + bottom, pajama set, etc.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="btn-secondary shrink-0 text-xs"
      >
        + Link
      </button>
    </section>
  );
}
