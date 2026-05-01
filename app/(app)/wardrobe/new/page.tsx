import { Suspense } from "react";
import Link from "next/link";
import AddItemForm from "./AddItemForm";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const sp = await searchParams;
  const batch = sp.batch === "1";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">
            {batch ? "Quick add" : "Add a piece"}
          </h1>
          <p className="text-sm text-stone-500">
            {batch
              ? "Snap, save, repeat — the camera reopens for the next piece."
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
            🗂 Import from library
          </Link>
        </div>
      </div>
      <Suspense>
        <AddItemForm />
      </Suspense>
    </div>
  );
}
