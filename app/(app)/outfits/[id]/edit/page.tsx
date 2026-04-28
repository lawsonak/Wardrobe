import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import OutfitBuilder, { type InitialOutfit } from "../../builder/OutfitBuilder";

export const dynamic = "force-dynamic";

export default async function EditOutfitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const [outfit, items] = await Promise.all([
    prisma.outfit.findFirst({
      where: { id, ownerId: userId },
      include: { items: { select: { itemId: true, slot: true } } },
    }),
    prisma.item.findMany({
      where: { ownerId: userId, status: "active" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!outfit) notFound();

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
      <div>
        <Link href="/outfits" className="text-sm text-blush-600 hover:underline">← Outfits</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Edit outfit</h1>
        <p className="text-sm text-stone-500">Add or remove pieces. Tap the same item again to deselect.</p>
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
