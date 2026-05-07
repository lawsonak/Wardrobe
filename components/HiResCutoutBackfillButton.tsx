"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// Settings → "Generate hi-res cutouts" maintenance button. Walks
// every Item with no imageBgRemovedOriginalPath and runs the medium-
// model bg removal worker over each. The result is the cutout the
// lightbox tap-to-zoom prefers — clean garment, no floor / wall
// behind it, full-resolution detail.
//
// Fires the route in background mode so the user can close the tab;
// the bell drops a notification once the run finishes.
export default function HiResCutoutBackfillButton({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await confirmDialog({
      title: `Generate hi-res cutouts for ${pendingCount} item${pendingCount === 1 ? "" : "s"}?`,
      body:
        "Each photo runs through the bg-removal model at full resolution so the lightbox tap-to-zoom shows a clean garment cutout. " +
        "Takes 5–15 s per photo on the server — runs in the background, you'll get a notification when it's done.",
      confirmText: "Generate",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bg-remove-hires-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        queued?: boolean;
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        toast(data.error ?? "Couldn't start the backfill", "error");
        return;
      }
      if (data.queued) {
        toast(
          `Generating cutouts for ${data.count} item${data.count === 1 ? "" : "s"} on the server — feel free to close the tab`,
        );
      } else if ((data.count ?? 0) === 0) {
        toast("Nothing to backfill — every item already has a hi-res cutout");
      }
      router.refresh();
    } catch {
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy} className="btn-secondary">
      {busy ? "Starting…" : "Generate hi-res cutouts"}
    </button>
  );
}
