"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type ReviewItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  seasons: string[];
  activities: string[];
};

export default function NeedsReviewItem({ item }: { item: ReviewItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;

  const missing = [
    !item.brand && "brand",
    !item.size && "size",
    !item.color && "color",
    item.seasons.length === 0 && "season",
    item.activities.length === 0 && "activity",
  ].filter(Boolean) as string[];

  async function approve() {
    setBusy(true);
    haptic("success");
    const res = await fetch(`/api/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    setBusy(false);
    if (res.ok) {
      toast("Approved — moved to closet");
      router.refresh();
    } else {
      toast("Couldn't approve", "error");
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this item?",
      body: "It will be removed from your closet permanently.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast("Item deleted");
      router.refresh();
    } else {
      toast("Couldn't delete", "error");
    }
  }

  return (
    <div className="card flex gap-3 p-3">
      <div className="tile-bg h-20 w-20 shrink-0 overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain p-1" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-stone-800">
          {item.subType ?? item.category}
        </p>
        <p className="text-xs text-stone-500">
          {[item.brand, item.category, item.size].filter(Boolean).join(" · ")}
        </p>

        {missing.length > 0 && (
          <p className="mt-1 text-xs text-amber-600">
            Missing: {missing.join(", ")}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/wardrobe/${item.id}?edit=1`} className="chip chip-off text-xs">
            Edit details
          </Link>
          <button
            onClick={approve}
            disabled={busy}
            className="chip chip-off text-xs text-green-700 ring-green-200"
          >
            ✓ Approve
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="text-xs text-stone-400 hover:text-blush-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
