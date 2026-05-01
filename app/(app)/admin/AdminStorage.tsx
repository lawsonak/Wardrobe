"use client";

import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ConfirmDialog";

type Storage = {
  totalFiles: number;
  totalBytes: number;
  orphans: string[];
  missing: string[];
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AdminStorage() {
  const [data, setData] = useState<Storage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/storage");
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (err) {
      console.error(err);
      setMessage("Couldn't load storage info.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function cleanup() {
    if (!data || data.orphans.length === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${data.orphans.length} orphaned file${data.orphans.length === 1 ? "" : "s"}?`,
      body: "These photos aren't referenced by any item. This is permanent.",
      confirmText: "Delete files",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/cleanup-orphans", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as { deleted: number; bytes: number };
      setMessage(`Deleted ${d.deleted} file${d.deleted === 1 ? "" : "s"} (${formatBytes(d.bytes)}).`);
      await load();
    } catch (err) {
      console.error(err);
      setMessage("Cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-stone-500">Scanning…</p>;
  }
  if (!data) return <p className="text-sm text-blush-700">{message}</p>;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-cream-100 p-3">
          <dt className="text-xs text-stone-500">Files</dt>
          <dd className="font-display text-2xl text-blush-700">{data.totalFiles}</dd>
        </div>
        <div className="rounded-xl bg-cream-100 p-3">
          <dt className="text-xs text-stone-500">Total size</dt>
          <dd className="font-display text-2xl text-blush-700">{formatBytes(data.totalBytes)}</dd>
        </div>
        <div className="rounded-xl bg-cream-100 p-3">
          <dt className="text-xs text-stone-500">Orphans</dt>
          <dd className="font-display text-2xl text-blush-700">{data.orphans.length}</dd>
        </div>
      </dl>

      {data.missing.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
          {data.missing.length} item{data.missing.length === 1 ? "" : "s"} reference a photo that&apos;s missing from disk. Re-upload from the item edit page.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={cleanup}
          className="btn-secondary"
          disabled={busy || data.orphans.length === 0}
          title={data.orphans.length === 0 ? "Nothing to clean up" : "Delete orphaned files"}
        >
          {busy ? "Cleaning…" : `Delete ${data.orphans.length} orphan${data.orphans.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={load} className="btn-ghost text-stone-600">Refresh</button>
        {message && <span className="text-sm text-stone-500">{message}</span>}
      </div>
    </div>
  );
}
