"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type SisterItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type ExistingSet = {
  id: string;
  name: string;
};

// "Part of a set?" panel on the item detail page.
//
// When the item is in a set: shows the set name + small thumbnail
// strip of sister items, with an Unlink button.
// When the item is not in a set: shows a "Link to a set" control
// with a small inline form that creates a new set or attaches to
// an existing one.
export default function SetLink({
  itemId,
  setId,
  setName,
  sisters,
  existingSets,
}: {
  itemId: string;
  setId: string | null;
  setName: string | null;
  sisters: SisterItem[];
  existingSets: ExistingSet[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pickedSetId, setPickedSetId] = useState<string>("");
  const [busy, setBusy] = useState(false);

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

  async function attachExisting() {
    if (!pickedSetId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: pickedSetId }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptic("success");
      toast("Linked to set");
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't link", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, itemIds: [itemId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      haptic("success");
      toast(`Created "${trimmed}"`);
      setOpen(false);
      setNewName("");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't create set", "error");
    } finally {
      setBusy(false);
    }
  }

  // Linked: show sisters + unlink.
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
            No other pieces yet. Open the set to link more.
          </p>
        )}
        <div className="mt-3">
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

  // Unlinked: link control.
  if (!open) {
    return (
      <section className="card flex items-center justify-between gap-3 p-4">
        <div>
          <p className="label mb-0">Matching set</p>
          <p className="text-xs text-stone-500">
            Link this piece to a top + bottom set, pajamas, etc.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">
          + Link
        </button>
      </section>
    );
  }

  return (
    <section className="card space-y-3 p-4">
      <p className="label mb-0">Link to a set</p>
      {existingSets.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-stone-500">Use an existing set</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pickedSetId}
              onChange={(e) => setPickedSetId(e.target.value)}
              className="input flex-1 min-w-[10rem]"
              aria-label="Existing set"
            >
              <option value="">— pick —</option>
              {existingSets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={attachExisting}
              disabled={busy || !pickedSetId}
              className="btn-secondary text-xs"
            >
              Add
            </button>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-stone-500">Or start a new set</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='e.g. "Black bikini set"'
            className="input flex-1 min-w-[10rem]"
            onKeyDown={(e) => { if (e.key === "Enter") createNew(); }}
            aria-label="New set name"
          />
          <button
            type="button"
            onClick={createNew}
            disabled={busy || !newName.trim()}
            className="btn-primary text-xs"
          >
            Create
          </button>
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={() => { setOpen(false); setNewName(""); setPickedSetId(""); }}
          className="text-xs text-stone-400 hover:text-stone-600"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
