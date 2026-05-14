import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionWizard from "../CollectionWizard";
import type { Selectable } from "../ItemPicker";
import { backroomItemFilter, readBackroomParam } from "@/lib/backroom";

export const dynamic = "force-dynamic";

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ backroom?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const sp = await searchParams;
  const includeBackroom = readBackroomParam(sp.backroom);

  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active", isBeauty: false, ...backroomItemFilter(includeBackroom) },
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
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/collections" className="text-sm text-blush-600 hover:underline">← Collections</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">New collection</h1>
          <p className="text-sm text-stone-500">Tell us about the trip — we&rsquo;ll handle the packing list.</p>
        </div>
        <Link
          href={includeBackroom ? "/collections/new" : "/collections/new?backroom=1"}
          className={"chip text-xs " + (includeBackroom ? "chip-on" : "chip-off")}
          title={includeBackroom ? "Hide 🌶 items from the picker" : "Include 🌶 items in the picker"}
        >
          🌶
        </Link>
      </div>
      <CollectionWizard items={selectable} includeBackroom={includeBackroom} />
    </div>
  );
}
