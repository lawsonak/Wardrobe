import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionCard from "./CollectionCard";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const collections = await prisma.collection.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        include: { item: true },
        // Pull enough for a swipeable preview without going overboard.
        take: 30,
      },
      _count: { select: { items: true } },
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">Collections</h1>
          <p className="text-sm text-stone-500">Trips and themed sets — destination, dates, activities, AI-curated packing.</p>
        </div>
        <Link href="/collections/new" className="btn-primary whitespace-nowrap">+ New</Link>
      </div>

      {collections.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl" aria-hidden>✈️</div>
          <p className="mt-3 font-display text-2xl text-blush-700">No collections yet</p>
          <p className="mt-1 text-stone-600">Plan a trip — destination, dates, activities — and let AI build your packing list.</p>
          <Link href="/collections/new" className="btn-primary mt-4 inline-flex">Plan your first trip</Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {collections.map((c) => {
            const range = formatDateRange(c.startDate, c.endDate);
            const startLabel = c.startDate ? formatSingle(c.startDate) : null;
            const endLabel = c.endDate ? formatSingle(c.endDate) : null;
            return (
              <CollectionCard
                key={c.id}
                collection={{
                  id: c.id,
                  name: c.name,
                  kind: c.kind,
                  destination: c.destination,
                  occasion: c.occasion,
                  season: c.season,
                  startDateLabel: range || startLabel,
                  endDateLabel: range ? null : endLabel,
                  itemCount: c._count.items,
                  items: c.items.map(({ item }) => ({
                    id: item.id,
                    imagePath: item.imagePath,
                    imageBgRemovedPath: item.imageBgRemovedPath,
                    category: item.category,
                    subType: item.subType,
                  })),
                }}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "";
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return sameMonth
    ? `${fmt(start).split(" ")[0]} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${fmt(start)} → ${fmt(end)}`;
}

function formatSingle(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
