"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// Three bulk actions for the Needs Review inbox:
//   ✨ AI-tag all — runs Auto-tag on the queue (server-side, capped
//      at 25; promotes to active above the confidence threshold).
//   ✂️ Background-remove all — kicks off server-side bg removal on
//      the queue. Fire-and-forget; a notification fires when done.
//   ✓ Approve all — marks every needs-review row as active in one
//      DB call. The user is the gate: a confirm dialog precedes it
//      so a misclick can't silently empty the inbox.
//
// Lives in a single component so the bar can wrap together on
// mobile and the surrounding card has one consistent layout.
export default function BulkActionsBar({ itemIds }: { itemIds: string[] }) {
  const router = useRouter();
  const count = itemIds.length;
  const [tagBusy, setTagBusy] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [promoteAtConfidence, setPromoteAtConfidence] = useState(0.85);

  const anyBusy = tagBusy || bgBusy || approveBusy;

  async function aiTagAll() {
    if (
      !confirm(
        `AI-tag up to ${Math.min(count, 25)} item${count === 1 ? "" : "s"}? ` +
          `Items the model is at least ${Math.round(promoteAtConfidence * 100)}% sure about will move to active.`,
      )
    ) {
      return;
    }
    setTagBusy(true);
    setTagMessage("Tagging…");
    try {
      const res = await fetch("/api/ai/tag-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoteAtConfidence, limit: 25 }),
      });
      const data = await res.json();
      if (data?.enabled === false) {
        setTagMessage(data.message ?? "AI tagging is disabled.");
        return;
      }
      setTagMessage(
        `Tagged ${data.tagged ?? 0} of ${data.processed ?? 0}` +
          `${data.promoted ? `, promoted ${data.promoted} to active` : ""}` +
          `${data.errors ? `, ${data.errors} error${data.errors === 1 ? "" : "s"}` : ""}.`,
      );
      router.refresh();
    } catch (err) {
      console.error(err);
      setTagMessage(err instanceof Error ? err.message : "Bulk tag failed.");
    } finally {
      setTagBusy(false);
    }
  }

  async function bgRemoveAll() {
    if (count === 0) return;
    const ok = await confirmDialog({
      title: `Remove backgrounds from ${count} item${count === 1 ? "" : "s"}?`,
      body: "Runs on the server. You'll get a notification when it's done — feel free to close the tab.",
      confirmText: "Run it",
    });
    if (!ok) return;
    setBgBusy(true);
    try {
      const res = await fetch("/api/items/bg-remove-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds, background: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't start background removal", "error");
        return;
      }
      toast(
        `Cutting backgrounds for ${data.count ?? count} item${(data.count ?? count) === 1 ? "" : "s"} on the server`,
      );
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBgBusy(false);
    }
  }

  async function approveAll() {
    if (count === 0) return;
    const ok = await confirmDialog({
      title: `Approve all ${count} item${count === 1 ? "" : "s"}?`,
      body: "They'll move into the active closet. You can still edit them after.",
      confirmText: "Approve all",
    });
    if (!ok) return;
    setApproveBusy(true);
    try {
      const res = await fetch("/api/items/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't approve", "error");
        return;
      }
      toast(`Approved ${data.approved ?? 0} item${(data.approved ?? 0) === 1 ? "" : "s"}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={aiTagAll}
          disabled={anyBusy}
          className="btn-secondary text-sm"
          title="Run Auto-tag on up to 25 items"
        >
          {tagBusy ? "Tagging…" : "✨ AI-tag all"}
        </button>
        <button
          type="button"
          onClick={bgRemoveAll}
          disabled={anyBusy}
          className="btn-secondary text-sm"
          title="Cut backgrounds out on the server (notification when done)"
        >
          {bgBusy ? "Starting…" : "✂️ Remove backgrounds"}
        </button>
        <button
          type="button"
          onClick={approveAll}
          disabled={anyBusy}
          className="btn-secondary text-sm text-sage-700 ring-sage-200"
          title="Mark every needs-review item as active"
        >
          {approveBusy ? "Approving…" : `✓ Approve all (${count})`}
        </button>
        <label className="text-xs text-stone-500">
          AI promote at
          <input
            type="number"
            min={0.5}
            max={1}
            step={0.05}
            value={promoteAtConfidence}
            onChange={(e) => setPromoteAtConfidence(Number(e.target.value))}
            disabled={anyBusy}
            className="ml-1 w-14 rounded border border-stone-200 px-1 text-xs"
          />
          confidence
        </label>
      </div>
      {tagMessage && (
        <p className="text-xs text-stone-500">{tagMessage}</p>
      )}
    </div>
  );
}
