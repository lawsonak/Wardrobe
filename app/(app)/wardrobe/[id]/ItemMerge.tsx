"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

export type MergeCandidate = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
};

// Merge other closet items into this one. Originally built for the
// bulk-tag-photo flow: the user dumps a stack of clothing-tag close-ups
// into bulk upload, each one lands as a standalone "needs_review" item,
// and from the actual garment's edit page they pick which of those
// orphan items belong on it. Server folds them in as kind="label"
// ItemPhoto rows and deletes the source items.
//
// The default kind is "label" because that's the dominant flow, but
// we expose "Other angle" too for the rare case where someone
// double-uploaded the same garment and wants to consolidate.
export default function ItemMerge({
  itemId,
  candidates,
}: {
  itemId: string;
  candidates: MergeCandidate[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asKind, setAsKind] = useState<"label" | "angle">("label");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const haystack = [c.subType, c.category, c.brand].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [candidates, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setSelected(new Set());
    setFilter("");
    setError(null);
  }

  async function confirm() {
    if (selected.size === 0) {
      setError("Pick at least one item to merge in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: [...selected], asKind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      haptic("success");
      const n = selected.size;
      toast(`Merged ${n} item${n === 1 ? "" : "s"} in`);
      setOpen(false);
      setSelected(new Set());
      setFilter("");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't merge.");
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-stone-400">
        Nothing else in your closet to merge in yet.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-xs"
      >
        🔀 Merge other items in…
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Merge other items into this one"
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-sm sm:items-center"
          onClick={close}
        >
          <div
            className="card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-stone-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-stone-800">
                    Merge items into this one
                  </h2>
                  <p className="mt-0.5 text-xs text-stone-500">
                    Pick items whose photos belong on <em>this</em> garment.
                    Each one gets folded in and removed from the closet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <fieldset className="flex items-center gap-1 rounded-full bg-stone-100 p-0.5 text-xs">
                  <legend className="sr-only">Add as</legend>
                  {(["label", "angle"] as const).map((k) => (
                    <label
                      key={k}
                      className={
                        "cursor-pointer rounded-full px-2.5 py-1 " +
                        (asKind === k
                          ? "bg-white text-stone-800 shadow-sm"
                          : "text-stone-500 hover:text-stone-700")
                      }
                    >
                      <input
                        type="radio"
                        name="merge-kind"
                        value={k}
                        checked={asKind === k}
                        onChange={() => setAsKind(k)}
                        className="sr-only"
                      />
                      {k === "label" ? "As labels" : "As other angles"}
                    </label>
                  ))}
                </fieldset>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="input flex-1 min-w-[8rem] text-xs"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-stone-400">
                  No items match.
                </p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {filtered.map((c) => {
                    const checked = selected.has(c.id);
                    const src = c.imageBgRemovedPath
                      ? `/api/uploads/${c.imageBgRemovedPath}`
                      : `/api/uploads/${c.imagePath}`;
                    const caption = c.subType ?? c.category;
                    return (
                      <li key={c.id}>
                        <label
                          className={
                            "flex cursor-pointer flex-col gap-1 rounded-xl p-1.5 ring-1 transition " +
                            (checked
                              ? "bg-blush-50 ring-blush-300"
                              : "ring-stone-100 hover:ring-stone-200")
                          }
                        >
                          <span className="tile-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={caption}
                              className="h-full w-full object-contain p-1"
                            />
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-stone-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(c.id)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="truncate">{caption}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-stone-100 p-3">
              {error && <p className="mb-2 text-xs text-blush-700">{error}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-stone-500">
                  {selected.size === 0
                    ? "Nothing selected"
                    : `${selected.size} selected`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="btn-ghost text-xs text-stone-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={busy || selected.size === 0}
                    className="btn-primary text-xs"
                  >
                    {busy ? "Merging…" : `Merge ${selected.size || ""}`.trim()}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
