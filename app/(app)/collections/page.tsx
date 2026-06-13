import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CollectionCard from "./CollectionCard";
import EmptyState from "@/components/EmptyState";
import { backroomCollectionFilter, readBackroomParam } from "@/lib/backroom";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ backroom?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const sp = await searchParams;
  const includeBackroom = readBackroomParam(sp.backroom);

  const collections = await prisma.collection.findMany({
    where: { ownerId: userId, ...backroomCollectionFilter(includeBackroom) },
    orderBy: { updatedAt: "desc" },
    // Card preview only needs slot + thumbnail bits. Trim everything
    // else so a closet of 50+ trip-collections doesn't drag a few MB
    // of unused JSON over the wire on every page load.
    select: {
      id: true,
      name: true,
      kind: true,
      destination: true,
      occasion: true,
      season: true,
      startDate: true,
      endDate: true,
      items: {
        // Pull enough for a swipeable preview without going overboard.
        take: 30,
        select: {
          item: {
            select: {
              id: true,
              imagePath: true,
              imageBgRemovedPath: true,
              category: true,
              subType: true,
            },
          },
        },
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
        <div className="flex items-center gap-2">
          <Link
            href={includeBackroom ? "/collections" : "/collections?backroom=1"}
            className={"chip text-xs " + (includeBackroom ? "chip-on" : "chip-off")}
            title={includeBackroom ? "Hide collections with 🌶 items" : "Include collections with 🌶 items"}
          >
            🌶
          </Link>
          <Link href="/collections/new" className="btn-primary whitespace-nowrap">+ New</Link>
        </div>
      </div>

      {collections.length === 0 ? (
        <EmptyState
          emoji="✈️"
          headline="Plan your first trip."
          hint="Destination + dates + activities, and AI builds the packing list."
          primaryHref="/collections/new"
          primaryLabel="Plan a trip"
        />
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
