import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// /looks — saved Look list. Reached from the chip on /wardrobe/beauty
// (no top-level nav, per the spec). Each card shows a static product
// collage (up to 4 product photos) rather than a try-on render — a
// Look is a routine, not a mannequin composite.
export default async function LooksPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const looks = await prisma.look.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      notes: true,
      updatedAt: true,
      items: {
        // Cap at 4 thumbs for the collage; the detail page shows
        // the full set.
        take: 4,
        select: {
          slot: true,
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
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/wardrobe/beauty" className="text-sm text-blush-600 hover:underline">← 💄</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">Looks</h1>
          <p className="text-sm text-stone-500">
            {looks.length} saved · bundles of beauty products you wear together.
          </p>
        </div>
        <Link href="/looks/new" className="btn-primary whitespace-nowrap">+ New</Link>
      </div>

      {looks.length === 0 ? (
        <EmptyState
          emoji="💄"
          headline="Save your first Look."
          hint='An "Everyday face" or a "Date-night smoky" — pick products into the 15 slots and reuse it whenever.'
          primaryHref="/looks/new"
          primaryLabel="Build a Look"
          secondaryHref="/wardrobe/beauty"
          secondaryLabel="See beauty stash"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {looks.map((look) => (
            <li key={look.id}>
              <Link
                href={`/looks/${look.id}`}
                className="block overflow-hidden rounded-2xl bg-white ring-1 ring-stone-100 hover:ring-blush-300"
              >
                <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px bg-stone-100">
                  {look.items.slice(0, 4).map(({ slot, item }) => (
                    <div
                      key={item.id + slot}
                      className="tile-bg relative flex items-center justify-center p-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          item.imageBgRemovedPath
                            ? `/api/uploads/${item.imageBgRemovedPath}`
                            : `/api/uploads/${item.imagePath}`
                        }
                        alt={slot}
                        className="h-full w-full object-contain"
                      />
                      {item.shadeHex && (
                        <span
                          className="absolute bottom-1 right-1 h-3 w-3 rounded-full ring-1 ring-white"
                          style={{ backgroundColor: item.shadeHex }}
                          aria-hidden
                        />
                      )}
                    </div>
                  ))}
                  {/* Empty cells pad the collage so a look with 1
                      product still shows a 2×2 grid (3 blank tiles). */}
                  {Array.from({ length: Math.max(0, 4 - look.items.length) }).map((_, i) => (
                    <div key={`pad-${i}`} className="tile-bg" />
                  ))}
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate font-display text-lg text-stone-800">
                    {look.name}
                  </p>
                  <p className="text-xs text-stone-500">
                    {look._count.items} product{look._count.items === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
