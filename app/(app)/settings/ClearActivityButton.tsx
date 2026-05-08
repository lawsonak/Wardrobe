"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Tiny client island for the "Clear history" action on the Settings →
// Activity card. Confirms before nuking, calls DELETE /api/activity,
// then asks the server component to refresh so the cleared list
// repaints (with a single "Cleared activity history" entry written
// by the route as the last record).
export default function ClearActivityButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (count === 0) return null;

  async function clear() {
    if (!window.confirm("Clear all activity history? This can't be undone.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/activity", { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear history");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={clear}
        disabled={busy || pending}
        className="text-xs text-blush-600 hover:underline disabled:opacity-50"
      >
        {busy || pending ? "Clearing…" : "Clear history"}
      </button>
      {error && <span className="text-xs text-blush-700">{error}</span>}
    </div>
  );
}
