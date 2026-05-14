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
  const [items, looks] = await Promise.all([
    prisma.item.findMany({
      where: {
        ownerId: userId,
        status: "active",
        // Beauty items aren't pickable from the outfit builder — they
        // attach via a separate Look pairing (PR D). Hard-exclude here
        // even when an existing OutfitItem somehow points at one (it
        // shouldn't, but the guard keeps the picker clean).
        isBeauty: false,
        OR: [
          ...(includeBackroom ? [{}] : [{ isBackroom: false }]),
          { id: { in: existingItemIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.look.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        items: {
          take: 4,
          select: {
            item: {
              select: {
                id: true,
                imagePath: true,
                imageBgRemovedPath: true,
                shadeHex: true,
              },
            },
          },
        },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const availableLooks = looks.map((l) => ({
    id: l.id,
    name: l.name,
    itemCount: l._count.items,
    thumbs: l.items.map(({ item }) => ({
      id: item.id,
      src: item.imageBgRemovedPath
        ? `/api/uploads/${item.imageBgRemovedPath}`
        : `/api/uploads/${item.imagePath}`,
      shadeHex: item.shadeHex,
    })),
  }));

  const initial: InitialOutfit = {
    id: outfit.id,
    name: outfit.name,
    activity: outfit.activity,
    season: outfit.season,
    isFavorite: outfit.isFavorite,
    items: outfit.items.map((i) => ({ itemId: i.itemId, slot: i.slot })),
    lookId: outfit.lookId,
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
          title={includeBackroom ? "Hide 🌶 items from the picker" : "Include 🌶 items in the picker"}
        >
          🌶
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
          availableLooks={availableLooks}
        />
      </Suspense>
    </div>
  );
}
