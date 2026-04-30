"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type Member = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

export default function SetEditor({
  set,
}: {
  set: {
    id: string;
    name: string;
    notes: string | null;
    items: Member[];
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(set.name);
  const [notes, setNotes] = useState(set.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Give the set a name", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sets/${set.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), notes: notes.trim() || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptic("success");
      toast("Saved");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't save", "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(itemId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptic("tap");
      toast("Removed from set");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't remove", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSet() {
    const ok = await confirmDialog({
      title: `Delete "${set.name}"?`,
      body: "The pieces stay in your closet — only this set link is removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sets/${set.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast("Set deleted");
      router.push("/sets");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't delete", "error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-3 p-4">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Black bikini set"'
          />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea
            className="input min-h-[60px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          Save
        </button>
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-xl text-stone-800">Pieces</h2>
          <span className="text-xs text-stone-500">
            {set.items.length} piece{set.items.length === 1 ? "" : "s"}
          </span>
        </div>
        {set.items.length === 0 ? (
          <p className="text-sm text-stone-500">
            No pieces yet. Open any item from the closet and tap <strong>Link</strong>
            {" "}in its &ldquo;Matching set&rdquo; card.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {set.items.map((it) => {
              const src = it.imageBgRemovedPath
                ? `/api/uploads/${it.imageBgRemovedPath}`
                : `/api/uploads/${it.imagePath}`;
              return (
                <li key={it.id} className="card overflow-hidden">
                  <Link
                    href={`/wardrobe/${it.id}`}
                    className="tile-bg flex aspect-square items-center justify-center p-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={it.subType ?? it.category}
                      className="h-full w-full object-contain"
                    />
                  </Link>
                  <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <p className="truncate text-stone-700">{it.subType ?? it.category}</p>
                    <button
                      type="button"
                      onClick={() => removeMember(it.id)}
                      disabled={busy}
                      className="text-stone-400 hover:text-blush-600"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="border-t border-stone-100 pt-3 text-center">
        <button
          type="button"
          onClick={deleteSet}
          disabled={busy}
          className="text-xs text-stone-400 hover:text-blush-700"
        >
          Delete this set
        </button>
      </div>
    </div>
  );
}
