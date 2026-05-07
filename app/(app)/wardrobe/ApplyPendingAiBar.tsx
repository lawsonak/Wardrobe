"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// Action bar surfaced on /wardrobe?pending=1 when there are items
// with staged AI suggestions waiting for review. Lets the user
// approve them all at once instead of opening each item's edit page
// and tapping "Accept" per row. Suggestions are applied to the
// item's fields and the staging blob is cleared in a single bulk
// route call (`/api/items/apply-pending-all`).
export default function ApplyPendingAiBar({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await confirmDialog({
      title: `Apply AI suggestions to ${count} item${count === 1 ? "" : "s"}?`,
      body:
        "Each item's staged values (category, sub-type, color, brand, size, seasons, activities, material) will overwrite what's there. " +
        "Material only fills in when the fit notes field is empty — a typed care note won't get clobbered.",
      confirmText: "Apply all",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/items/apply-pending-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        applied?: number;
        errors?: number;
        error?: string;
      };
      if (!res.ok) {
        toast(data.error ?? "Couldn't apply suggestions", "error");
        return;
      }
      const applied = data.applied ?? 0;
      const errors = data.errors ?? 0;
      const msg =
        applied === 0
          ? "Nothing to apply"
          : errors > 0
            ? `Applied ${applied}, ${errors} couldn't be processed`
            : `Applied to ${applied} item${applied === 1 ? "" : "s"}`;
      toast(msg);
      router.refresh();
    } catch {
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-blush-50 px-4 py-3 ring-1 ring-blush-100">
      <div className="text-sm text-stone-700">
        <span className="font-medium">{count} item{count === 1 ? "" : "s"}</span> with AI suggestions waiting for review.
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy || count === 0}
        className="btn-primary text-xs"
      >
        {busy ? "Applying…" : "Apply all"}
      </button>
    </div>
  );
}
