"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BulkAiTagButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [promoteAtConfidence, setPromoteAtConfidence] = useState(0.85);

  async function run() {
    if (busy) return;
    if (
      !confirm(
        `AI-tag up to ${Math.min(count, 25)} item${count === 1 ? "" : "s"}? ` +
          `Items the model is at least ${Math.round(promoteAtConfidence * 100)}% sure about will move to active.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("Tagging…");
    try {
      const res = await fetch("/api/ai/tag-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoteAtConfidence, limit: 25 }),
      });
      const data = await res.json();
      if (data?.enabled === false) {
        setMessage(data.message ?? "AI tagging is disabled.");
        return;
      }
      setMessage(
        `Tagged ${data.tagged ?? 0} of ${data.processed ?? 0}` +
          `${data.promoted ? `, promoted ${data.promoted} to active` : ""}` +
          `${data.errors ? `, ${data.errors} error${data.errors === 1 ? "" : "s"}` : ""}.`,
      );
      router.refresh();
    } catch (err) {
      console.error(err);
      setMessage(err instanceof Error ? err.message : "Bulk tag failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className="btn-secondary text-sm">
        {busy ? "Tagging…" : "✨ AI-tag all"}
      </button>
      <label className="text-xs text-stone-500">
        Auto-promote at
        <input
          type="number"
          min={0.5}
          max={1}
          step={0.05}
          value={promoteAtConfidence}
          onChange={(e) => setPromoteAtConfidence(Number(e.target.value))}
          disabled={busy}
          className="ml-1 w-14 rounded border border-stone-200 px-1 text-xs"
        />
        confidence
      </label>
      {message && <span className="text-xs text-stone-500">{message}</span>}
    </div>
  );
}
