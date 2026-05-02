"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

type CollectionItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

export type CollectionRow = {
  id: string;
  name: string;
  kind: string;
  destination: string | null;
  occasion: string | null;
  season: string | null;
  startDateLabel: string | null;
  endDateLabel: string | null;
  itemCount: number;
  items: CollectionItem[];
};

// Per-collection list-page card. Mirrors the OutfitCard pattern: the
// preview tile + title link to the editor, with a small action row
// for destructive ops. Delete uses the existing
// `DELETE /api/collections/[id]` endpoint and Prisma cascade
// (collectionItems and outfits link to collection via SetNull /
// onDelete).
export default function CollectionCard({ collection }: { collection: CollectionRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isTrip = collection.kind === "trip";
  const dateLabel = collection.startDateLabel
    ? collection.endDateLabel && collection.endDateLabel !== collection.startDateLabel
      ? `${collection.startDateLabel} → ${collection.endDateLabel}`
      : collection.startDateLabel
    : "";
  const subtitle = isTrip
    ? [collection.destination, dateLabel].filter(Boolean).join(" · ")
    : [collection.occasion, collection.season].filter(Boolean).join(" · ");

  // Shrink-to-fit preview grid: same logic the page used inline,
  // moved here so the card owns its own rendering.
  const itemCount = collection.items.length;
  const cols = Math.max(3, Math.min(5, Math.ceil(itemCount / 2)));
  const overflows = itemCount > 10;
  const gridStyle: React.CSSProperties = overflows
    ? {
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        gridAutoFlow: "column",
        gridAutoColumns: "calc((100% - 1.5rem - 2rem) / 5)",
      }
    : {
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        gridAutoFlow: "column",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      };

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete "${collection.name}"?`,
      body:
        collection.kind === "trip"
          ? "The trip plan and packing list go away. The pieces in your closet stay."
          : "The collection is removed. The pieces in your closet stay.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    haptic("impact");
    const res = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast("Collection deleted");
      router.refresh();
    } else {
      toast("Couldn't delete collection", "error");
    }
  }

  return (
    <li className="card overflow-hidden transition hover:shadow-md">
      {itemCount === 0 ? (
        <Link
          href={`/collections/${collection.id}`}
          className="tile-bg flex aspect-[3/2] items-center justify-center text-sm text-stone-400"
        >
          empty — open to add pieces
        </Link>
      ) : (
        <div
          className="tile-bg no-scrollbar grid aspect-[3/2] snap-x gap-2 overflow-x-auto p-3"
          style={gridStyle}
          aria-label={`${collection.name} preview${overflows ? " — swipe to see more" : ""}`}
        >
          {collection.items.map((item) => {
            const src = item.imageBgRemovedPath
              ? `/api/uploads/${item.imageBgRemovedPath}`
              : `/api/uploads/${item.imagePath}`;
            return (
              <Link
                key={item.id}
                href={`/collections/${collection.id}`}
                className="flex snap-start items-center justify-center rounded-xl bg-white/60 p-1"
                aria-label={`${item.subType ?? item.category} — open ${collection.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={item.subType ?? item.category}
                  draggable={false}
                  className="h-full w-full object-contain"
                />
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Link href={`/collections/${collection.id}`} className="min-w-0 flex-1">
          <p className="truncate font-display text-lg text-stone-800">
            <span className="mr-1.5" aria-hidden>{isTrip ? "✈️" : "🧺"}</span>
            {collection.name}
          </p>
          <p className="truncate text-xs text-stone-500">
            {subtitle || "—"}
            <span className="text-stone-300"> · </span>
            {collection.itemCount} piece{collection.itemCount === 1 ? "" : "s"}
          </p>
        </Link>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="btn-icon shrink-0 text-stone-400 hover:text-blush-600"
          aria-label={`Delete collection "${collection.name}"`}
          title="Delete collection"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>
    </li>
  );
}
