"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";

export default function MergeBrandsControl({
  a,
  b,
}: {
  a: { id: string; name: string };
  b: { id: string; name: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge(sourceId: string, targetId: string) {
    const sourceName = sourceId === a.id ? a.name : b.name;
    const targetName = targetId === a.id ? a.name : b.name;
    const ok = await confirmDialog({
      title: `Merge "${sourceName}" into "${targetName}"?`,
      body: `All items currently tagged "${sourceName}" will be re-tagged "${targetName}".`,
      confirmText: "Merge",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${sourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => merge(b.id, a.id)}
        className="btn-secondary text-xs"
        disabled={busy}
        title={`Use "${a.name}", drop "${b.name}"`}
      >
        Use {a.name}
      </button>
      <button
        type="button"
        onClick={() => merge(a.id, b.id)}
        className="btn-secondary text-xs"
        disabled={busy}
        title={`Use "${b.name}", drop "${a.name}"`}
      >
        Use {b.name}
      </button>
      {error && <span className="text-blush-700">{error}</span>}
    </div>
  );
}
