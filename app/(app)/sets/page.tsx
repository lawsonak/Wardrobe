import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const sets = await prisma.itemSet.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        select: {
          id: true, imagePath: true, imageBgRemovedPath: true,
          category: true, subType: true,
        },
        orderBy: { createdAt: "asc" },
        take: 6,
      },
      _count: { select: { items: true } },
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">Matching sets</h1>
          <p className="text-sm text-stone-500">
            Pieces that came together — swimsuit top + bottom, pajama set, lounge set.
            Each piece stays independent in your closet.
          </p>
        </div>
      </div>

      {sets.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>🎽</div>
          <p className="mt-3 font-display text-2xl text-blush-700">No sets yet</p>
          <p className="mt-1 text-stone-600">
            Open any item and tap <span className="font-medium">Link</span> in the
            &ldquo;Matching set&rdquo; card to create one.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id}>
              <div className="card overflow-hidden">
                <div className="tile-bg flex flex-wrap gap-2 p-3">
                  {s.items.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-stone-400">No pieces yet.</p>
                  ) : (
                    s.items.slice(0, 6).map((it) => {
                      const src = it.imageBgRemovedPath
                        ? `/api/uploads/${it.imageBgRemovedPath}`
                        : `/api/uploads/${it.imagePath}`;
                      return (
                        <Link
                          key={it.id}
                          href={`/wardrobe/${it.id}`}
                          className="flex aspect-square w-16 items-center justify-center overflow-hidden rounded-lg bg-white/60 ring-1 ring-stone-100 transition hover:opacity-90"
                          title={it.subType ?? it.category}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={it.subType ?? it.category}
                            className="h-full w-full object-contain p-1"
                          />
                        </Link>
                      );
                    })
                  )}
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-display text-lg text-stone-800">{s.name}</p>
                    <Link href={`/sets/${s.id}`} className="text-xs text-blush-600 hover:underline">
                      Manage →
                    </Link>
                  </div>
                  <p className="text-xs text-stone-500">
                    {s._count.items} piece{s._count.items === 1 ? "" : "s"}
                  </p>
                  {s.notes && <p className="mt-1 truncate text-xs text-stone-500">{s.notes}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
