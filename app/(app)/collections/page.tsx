import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

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
            const isTrip = c.kind === "trip";
            const subtitle = isTrip
              ? [c.destination, formatDateRange(c.startDate, c.endDate)].filter(Boolean).join(" · ")
              : [c.occasion, c.season].filter(Boolean).join(" · ");
            // Shrink-to-fit: keep the preview card the same overall
            // shape (aspect 3:2) and use 2 rows. As the collection
            // grows, the column count steps up (3 → 4 → 5) so more
            // items fit at smaller sizes without going below
            // recognizable. Past 10 items the strip overflows
            // horizontally so the user can swipe through the rest.
            const itemCount = c.items.length;
            const cols = Math.max(3, Math.min(5, Math.ceil(itemCount / 2)));
            const overflows = itemCount > 10;
            const gridStyle: React.CSSProperties = overflows
              ? {
                  gridTemplateRows: "repeat(2, minmax(0, 1fr))",
                  gridAutoFlow: "column",
                  // 5 cols visible per "page"; rest scroll. Keeps tile
                  // size consistent regardless of collection size.
                  gridAutoColumns: "calc((100% - 1.5rem - 2rem) / 5)",
                }
              : {
                  gridTemplateRows: "repeat(2, minmax(0, 1fr))",
                  gridAutoFlow: "column",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                };
            return (
              <li key={c.id} className="card overflow-hidden transition hover:shadow-md">
                {itemCount === 0 ? (
                  <Link
                    href={`/collections/${c.id}`}
                    className="tile-bg flex aspect-[3/2] items-center justify-center text-sm text-stone-400"
                  >
                    empty — open to add pieces
                  </Link>
                ) : (
                  <div
                    className="tile-bg no-scrollbar grid aspect-[3/2] snap-x gap-2 overflow-x-auto p-3"
                    style={gridStyle}
                    aria-label={`${c.name} preview${overflows ? " — swipe to see more" : ""}`}
                  >
                    {c.items.map(({ item }) => {
                      const src = item.imageBgRemovedPath
                        ? `/api/uploads/${item.imageBgRemovedPath}`
                        : `/api/uploads/${item.imagePath}`;
                      return (
                        <Link
                          key={item.id}
                          href={`/collections/${c.id}`}
                          className="flex snap-start items-center justify-center rounded-xl bg-white/60 p-1"
                          aria-label={`${item.subType ?? item.category} — open ${c.name}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={item.subType ?? item.category}
                            draggable={false}
                            className="h-full w-full object-contain"
                          />
                        </Link>
                      );
                    })}
                  </div>
                )}
                <Link href={`/collections/${c.id}`} className="block px-4 py-3">
                  <p className="truncate font-display text-lg text-stone-800">
                    <span className="mr-1.5" aria-hidden>{isTrip ? "✈️" : "🧺"}</span>
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    {subtitle || "—"}
                    <span className="text-stone-300"> · </span>
                    {c._count.items} piece{c._count.items === 1 ? "" : "s"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
