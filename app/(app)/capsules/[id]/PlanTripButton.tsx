"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import ProgressBar from "@/components/ProgressBar";
import { useTimedProgress } from "@/lib/progress";

// Triggers /api/capsules/[id]/plan. The first plan creates a fresh
// set of outfits attached to the capsule. Subsequent plans warn
// before replacing the existing set — the user almost always wants
// "regenerate" rather than "stack on top".
export default function PlanTripButton({
  capsuleId,
  hasExistingOutfits,
}: {
  capsuleId: string;
  hasExistingOutfits: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The AI call generates several outfits in one shot — usually 15-30s.
  const progress = useTimedProgress(busy, 25);

  async function plan() {
    let replaceExisting = false;
    if (hasExistingOutfits) {
      const ok = await confirmDialog({
        title: "Regenerate outfits?",
        body: "The previously planned outfits will be removed and replaced with a fresh set.",
        confirmText: "Regenerate",
      });
      if (!ok) return;
      replaceExisting = true;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/capsules/${capsuleId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceExisting }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setError(data.message ?? "AI is disabled.");
        return;
      }
      if (!res.ok || data?.error) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      const created: Array<{ id: string }> = data?.outfits ?? [];
      haptic("success");
      toast(
        created.length
          ? `Planned ${created.length} outfit${created.length === 1 ? "" : "s"}`
          : "AI returned no outfits",
      );
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't plan the trip.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={plan}
        disabled={busy}
        className="btn-primary text-sm"
      >
        {busy ? "Planning…" : hasExistingOutfits ? "✨ Re-plan with AI" : "✨ Plan outfits with AI"}
      </button>
      {busy && (
        <ProgressBar value={progress} label="Building your trip…" hint="usually 15-30s" />
      )}
      {error && <p className="text-xs text-blush-700">{error}</p>}
    </div>
  );
}
