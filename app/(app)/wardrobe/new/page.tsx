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
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">
            {batch ? "Batch add" : "Add a piece"}
          </h1>
          <p className="text-sm text-stone-500">
            {batch
              ? "Snap, save, repeat — the form clears itself between items."
              : "Snap a photo and tag it however you like."}
          </p>
        </div>
        {batch ? (
          <Link href="/wardrobe/new" className="btn-ghost text-stone-500">Done</Link>
        ) : (
          <Link href="/wardrobe/new?batch=1" className="btn-ghost text-blush-600">Batch mode</Link>
        )}
      </div>
      <Suspense>
        <AddItemForm />
      </Suspense>
    </div>
  );
}
