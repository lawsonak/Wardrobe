import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import OutfitBuilder, { type InitialOutfit } from "../../builder/OutfitBuilder";
import { readBackroomParam } from "@/lib/backroom";

export const dynamic = "force-dynamic";

export default async function EditOutfitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ backroom?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const includeBackroom = readBackroomParam(sp.backroom);

  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: { items: { select: { itemId: true, slot: true } } },
  });
  if (!outfit) notFound();

  // Items the outfit already contains stay visible regardless of the
  // toggle — otherwise editing an outfit that was built with Backroom
  // pieces would silently drop them from the picker. The toggle only
  // controls whether *other* Backroom items are pickable.
  const existingItemIds = outfit.items.map((i) => i.itemId);
  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      status: "active",
      OR: [
        ...(includeBackroom ? [{}] : [{ isBackroom: false }]),
        { id: { in: existingItemIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const initial: InitialOutfit = {
    id: outfit.id,
    name: outfit.name,
    activity: outfit.activity,
    season: outfit.season,
    isFavorite: outfit.isFavorite,
    items: outfit.items.map((i) => ({ itemId: i.itemId, slot: i.slot })),
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/outfits" className="text-sm text-blush-600 hover:underline">← Outfits</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">Edit outfit</h1>
          <p className="text-sm text-stone-500">Add or remove pieces. Tap the same item again to deselect.</p>
        </div>
        <Link
          href={includeBackroom ? `/outfits/${id}/edit` : `/outfits/${id}/edit?backroom=1`}
          className={"chip text-xs " + (includeBackroom ? "chip-on" : "chip-off")}
          title={includeBackroom ? "Hide Spicy items from the picker" : "Include Spicy items in the picker"}
        >
          🌶 Spicy
        </Link>
      </div>
      <Suspense>
        <OutfitBuilder
          items={items.map((i) => ({
            id: i.id,
            imagePath: i.imagePath,
            imageBgRemovedPath: i.imageBgRemovedPath,
            category: i.category,
            subType: i.subType,
            color: i.color,
            isFavorite: i.isFavorite,
            seasons: i.seasons,
            activities: i.activities,
          }))}
          initial={initial}
        />
      </Suspense>
    </div>
  );
}
