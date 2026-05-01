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
        take: 6,
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
            return (
              <li key={c.id}>
                <Link href={`/collections/${c.id}`} className="card block overflow-hidden transition hover:shadow-md">
                  <div className="tile-bg grid grid-cols-3 gap-2 p-3">
                    {c.items.slice(0, 6).map(({ item }) => {
                      const src = item.imageBgRemovedPath
                        ? `/api/uploads/${item.imageBgRemovedPath}`
                        : `/api/uploads/${item.imagePath}`;
                      return (
                        <div key={item.id} className="flex aspect-square items-center justify-center rounded-xl bg-white/60 p-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain" />
                        </div>
                      );
                    })}
                    {c.items.length === 0 && (
                      <div className="col-span-3 flex aspect-[3/1] items-center justify-center text-sm text-stone-400">
                        empty — open to add pieces
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <p className="truncate font-display text-lg text-stone-800">
                      <span className="mr-1.5" aria-hidden>{isTrip ? "✈️" : "🧺"}</span>
                      {c.name}
                    </p>
                    <p className="truncate text-xs text-stone-500">
                      {subtitle || "—"}
                      <span className="text-stone-300"> · </span>
                      {c._count.items} piece{c._count.items === 1 ? "" : "s"}
                    </p>
                  </div>
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
