"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

// "Try on with AI" — one-click outfit + try-on render anchored to
// this item. POSTs to /api/items/[id]/build-and-tryon (which builds
// the outfit) and navigates to /outfits/{id}/style, where TryOnView's
// auto-generate effect picks it up and runs the mannequin composite.
export default function TryOnButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/items/${itemId}/build-and-tryon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (data?.enabled === false) {
        toast(data.message ?? "AI is disabled.", "error");
        return;
      }
      if (!r.ok) {
        toast(data?.error ?? "Couldn't build a try-on outfit", "error");
        return;
      }
      // The /style page auto-fires the try-on render on mount when
      // there's no existing render yet, so the user lands on a
      // "generating…" state that resolves into the composite.
      router.push(`/outfits/${data.outfitId}/style`);
    } catch (err) {
      console.error(err);
      toast("Couldn't reach the server", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="btn-primary w-full text-sm disabled:opacity-50"
    >
      {busy ? "Building outfit…" : "✨ Try on with AI"}
    </button>
  );
}
