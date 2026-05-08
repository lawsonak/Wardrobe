import { Suspense } from "react";
import Link from "next/link";
import AddItemForm from "./AddItemForm";
import { readBackroomParam } from "@/lib/backroom";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; backroom?: string }>;
}) {
  const sp = await searchParams;
  const batch = sp.batch === "1";
  // ?backroom=1 — preselect the Backroom toggle on the form. Used by
  // the dedicated /wardrobe/backroom page's "+ Add" button so a piece
  // added there lands in the Backroom by default.
  const defaultBackroom = readBackroomParam(sp.backroom);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">
            {batch ? "Quick add" : defaultBackroom ? "🔒 Add to Backroom" : "Add a piece"}
          </h1>
          <p className="text-sm text-stone-500">
            {batch
              ? "Snap, save, repeat — the camera reopens for the next piece."
              : defaultBackroom
                ? "This piece will be hidden from the default closet, outfit builder, and AI prompts."
                : "Snap a photo and tag it however you like."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {batch ? (
            <Link href="/wardrobe/new" className="btn-secondary text-sm">
              ✓ Done
            </Link>
          ) : (
            <Link href="/wardrobe/new?batch=1" className="btn-secondary text-sm">
              📸 Quick add (one at a time)
            </Link>
          )}
          <Link href="/wardrobe/bulk" className="btn-secondary text-sm">
            🗂 Import from library (bulk)
          </Link>
        </div>
      </div>
      <Suspense>
        <AddItemForm defaultBackroom={defaultBackroom} />
      </Suspense>
    </div>
  );
}
