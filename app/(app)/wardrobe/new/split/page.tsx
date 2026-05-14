import Link from "next/link";
import SplitItemForm from "./SplitItemForm";

export const dynamic = "force-dynamic";

export default async function SplitItemPage({
  searchParams,
}: {
  searchParams: Promise<{ beauty?: string; backroom?: string }>;
}) {
  const sp = await searchParams;
  const defaultBeauty = sp.beauty === "1";
  const defaultBackroom = sp.backroom === "1";

  const backHref = defaultBeauty
    ? "/wardrobe/beauty"
    : defaultBackroom
      ? "/wardrobe/backroom"
      : "/wardrobe";

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-sm text-blush-600 hover:underline">
          ← Cancel
        </Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">
          {defaultBeauty ? "Split a 💄 shelf photo" : "✂ Split a multi-item photo"}
        </h1>
        <p className="text-sm text-stone-500">
          Best for flat-lays: pieces laid out side-by-side, a shopping-bag dump, or a
          {defaultBeauty ? " makeup-drawer shot" : " stack of clothing on a bed"}. AI detects each
          item, then you review and save them in one shot.
        </p>
      </div>
      <SplitItemForm defaultBeauty={defaultBeauty} defaultBackroom={defaultBackroom} />
    </div>
  );
}
