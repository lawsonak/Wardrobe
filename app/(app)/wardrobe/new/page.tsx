import { Suspense } from "react";
import Link from "next/link";
import AddItemForm from "./AddItemForm";
import { readBackroomParam } from "@/lib/backroom";
import { readBeautyParam } from "@/lib/beauty";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; backroom?: string; beauty?: string }>;
}) {
  const sp = await searchParams;
  const batch = sp.batch === "1";
  // ?backroom=1 — preselect the Backroom toggle on the form. Used by
  // the dedicated /wardrobe/backroom page's "+ Add" button so a piece
  // added there lands in the Backroom by default.
  const defaultBackroom = readBackroomParam(sp.backroom);
  // ?beauty=1 — same pattern for /wardrobe/beauty's + Add button.
  // Swaps the form into beauty mode (beauty category dropdown,
  // shade fields, finish picker, BarcodeScanner shortcut).
  const defaultBeauty = readBeautyParam(sp.beauty);

  const heading = batch
    ? "Quick add"
    : defaultBeauty
      ? "💄 Add a piece"
      : defaultBackroom
        ? "🌶 Add a piece"
        : "Add a piece";

  const subtitle = batch
    ? "Snap, save, repeat — the camera reopens for the next piece."
    : defaultBeauty
      ? "This piece will live in the 💄 page only — separate from your main closet and AI outfit prompts."
      : defaultBackroom
        ? "This piece will live in the 🌶 page only — hidden from the main closet, outfit builder, and AI prompts."
        : "Snap a photo and tag it however you like.";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{heading}</h1>
          <p className="text-sm text-stone-500">{subtitle}</p>
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
          {/* ✂ Split — one photo with multiple items in it. AI
              detects each piece and saves them as separate items.
              Forward the current bucket so a user adding from
              /wardrobe/beauty lands in beauty-mode split, etc. */}
          <Link
            href={
              defaultBeauty
                ? "/wardrobe/new/split?beauty=1"
                : defaultBackroom
                  ? "/wardrobe/new/split?backroom=1"
                  : "/wardrobe/new/split"
            }
            className="btn-secondary text-sm"
            title="One photo with multiple items? AI splits it into separate closet entries."
          >
            ✂ Split a multi-item photo
          </Link>
        </div>
      </div>
      <Suspense>
        <AddItemForm defaultBackroom={defaultBackroom} defaultBeauty={defaultBeauty} />
      </Suspense>
    </div>
  );
}
