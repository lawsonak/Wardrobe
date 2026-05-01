import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionEditor, { type CollectionData } from "../CollectionEditor";
import type { Selectable } from "../ItemPicker";

export const dynamic = "force-dynamic";

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const collection = await prisma.collection.findFirst({
    where: { id, ownerId: userId },
    include: { items: { select: { itemId: true } } },
  });
  if (!collection) notFound();

  const items = await prisma.item.findMany({
    where: { ownerId: userId },
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

  const subtitle = subtitleFor(collection);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/collections" className="text-sm text-blush-600 hover:underline">← Collections</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{collection.name}</h1>
        <p className="text-sm text-stone-500">{subtitle}</p>
      </div>
      <CollectionEditor collection={data} items={selectable} />
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
