import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionEditor, { type CollectionData } from "../CollectionEditor";
import type { Selectable } from "../ItemPicker";
import type { ShopItem } from "../CollectionShopItems";
import { readBackroomParam } from "@/lib/backroom";

export const dynamic = "force-dynamic";

export default async function CollectionDetailPage({
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

  const collection = await prisma.collection.findFirst({
    where: { id, ownerId: userId },
    include: {
      items: { select: { itemId: true } },
      shopItems: { orderBy: [{ purchased: "asc" }, { createdAt: "desc" }] },
    },
  });
  if (!collection) notFound();

  // Same pattern as the outfit editor: items already in the
  // collection always render so the user can de-select them, even
  // when the Backroom toggle is off.
  const existingItemIds = collection.items.map((i) => i.itemId);
  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      // Beauty items don't pack into trips. PR D will revisit if we
      // want to surface a "Looks for this trip" companion picker.
      isBeauty: false,
      OR: [
        ...(includeBackroom ? [{}] : [{ isBackroom: false }]),
        { id: { in: existingItemIds } },
      ],
    },
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

  const data: CollectionData = {
    id: collection.id,
    kind: collection.kind,
    name: collection.name,
    description: collection.description,
    destination: collection.destination,
    startDate: collection.startDate ? collection.startDate.toISOString().slice(0, 10) : null,
    endDate: collection.endDate ? collection.endDate.toISOString().slice(0, 10) : null,
    notes: collection.notes,
    occasion: collection.occasion,
    season: collection.season,
    activities: collection.activities,
    itemIds: collection.items.map((i) => i.itemId),
  };

  const shopItems: ShopItem[] = collection.shopItems.map((s) => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    category: s.category,
    color: s.color,
    price: s.price,
    link: s.link,
    imagePath: s.imagePath,
    source: s.source,
    notes: s.notes,
    purchased: s.purchased,
    tryOnImagePath: s.tryOnImagePath,
    tryOnGeneratedAt: s.tryOnGeneratedAt ? s.tryOnGeneratedAt.toISOString() : null,
  }));

  const subtitle = subtitleFor(collection);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/collections" className="text-sm text-blush-600 hover:underline">← Collections</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">{collection.name}</h1>
          <p className="text-sm text-stone-500">{subtitle}</p>
        </div>
        <Link
          href={includeBackroom ? `/collections/${id}` : `/collections/${id}?backroom=1`}
          className={"chip text-xs " + (includeBackroom ? "chip-on" : "chip-off")}
          title={includeBackroom ? "Hide 🌶 items from the picker" : "Include 🌶 items in the picker"}
        >
          🌶
        </Link>
      </div>
      <CollectionEditor
        collection={data}
        items={selectable}
        shopItems={shopItems}
        includeBackroom={includeBackroom}
      />
    </div>
  );
}

function subtitleFor(c: {
  kind: string;
  destination: string | null;
  startDate: Date | null;
  endDate: Date | null;
  occasion: string | null;
  season: string | null;
}): string {
  if (c.kind === "trip") {
    const range = formatDateRange(c.startDate, c.endDate);
    const parts = [c.destination, range].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Trip details, activities, and packing list.";
  }
  return [c.occasion, c.season].filter(Boolean).join(" · ") || "Edit pieces, occasion, and season.";
}

function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "";
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (start && end) {
    const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
    return sameMonth
      ? `${fmt(start).split(" ")[0]} ${start.getUTCDate()}–${end.getUTCDate()}`
      : `${fmt(start)} → ${fmt(end)}`;
  }
  return fmt((start ?? end)!);
}
