import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionWizard from "../CollectionWizard";
import type { Selectable } from "../ItemPicker";

export const dynamic = "force-dynamic";

export default async function NewCollectionPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  const selectable: Selectable[] = items.map((i) => ({
    id: i.id,
    imagePath: i.imagePath,
    imageBgRemovedPath: i.imageBgRemovedPath,
    category: i.category,
    subType: i.subType,
    brand: i.brand,
    isFavorite: i.isFavorite,
    seasons: i.seasons,
    activities: i.activities,
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/collections" className="text-sm text-blush-600 hover:underline">← Collections</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">New collection</h1>
        <p className="text-sm text-stone-500">Tell us about the trip — we&rsquo;ll handle the packing list.</p>
      </div>
      <CollectionWizard items={selectable} />
    </div>
  );
}
