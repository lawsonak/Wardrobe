"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Compact inline form on the dashboard. Type an occasion ("Sunday brunch",
// "Paris dinner"), AI picks a few items from the closet, the user lands
// in the builder pre-filled.
export default function AiOutfitPicker() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const text = occasion.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occasion: text }),
      });
      const data = await res.json();
      if (data?.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      const ids = (data.itemIds ?? []) as string[];
      if (ids.length === 0) {
        setError(data?.debug?.error ?? "AI didn't pick anything.");
        return;
      }
      const params = new URLSearchParams({ ids: ids.join(",") });
      if (data.name) params.set("name", String(data.name));
      router.push(`/outfits/builder?${params.toString()}`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "AI outfit failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        🤖 Build me an outfit
      </button>
    );
  }

  return (
    <div className="card flex w-full flex-wrap items-center gap-2 p-3">
      <input
        autoFocus
        className="input flex-1 min-w-[12rem]"
        placeholder="Occasion — e.g. Sunday brunch, Paris dinner"
        value={occasion}
        onChange={(e) => setOccasion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        disabled={busy}
      />
      <button type="button" onClick={go} disabled={busy || !occasion.trim()} className="btn-primary">
        {busy ? "Picking…" : "Go"}
      </button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }} className="btn-ghost text-stone-500">
        Cancel
      </button>
      {error && <span className="basis-full text-xs text-blush-700">{error}</span>}
    </div>
  );
}
