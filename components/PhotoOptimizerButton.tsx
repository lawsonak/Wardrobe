"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// Settings → Storage cleanup. Walks every closet item + extra angle
// photo whose `imageOriginalPath` is null (i.e. uploaded before
// two-tier storage shipped, or somehow missed) and re-runs the saved
// file through the regular upload pipeline so it ends up with both
// the small display variant and the preserved original.
//
// Foreground vs background: server-side runs in the background and
// fires a Notification when done so the user can close the tab.
// Empty case (nothing to fix) returns synchronously.
export default function PhotoOptimizerButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await confirmDialog({
      title: "Optimize old photos?",
      body:
        "Photos uploaded before the smaller-display-variant feature shipped — or any that were missed — will get a 1024-pixel display variant for faster closet loading. The full-resolution photo is preserved for tap-to-zoom. Runs in the background; you'll get a notification when it's done.",
      confirmText: "Optimize",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/optimize-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: true }),
      });
      const data = (await res.json()) as {
        queued?: boolean;
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        toast(data.error ?? "Couldn't start the optimizer", "error");
        return;
      }
      if (data.queued) {
        toast(
          `Optimizing ${data.count} photo${data.count === 1 ? "" : "s"} on the server — feel free to close the tab`,
        );
      } else if ((data.count ?? 0) === 0) {
        toast("Nothing to optimize — every photo is already the right size");
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy} className="btn-primary">
      {busy ? "Starting…" : "Optimize old photos"}
    </button>
  );
}
