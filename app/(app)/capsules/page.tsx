import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";

export const dynamic = "force-dynamic";

export default async function CapsulesPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const capsules = await prisma.capsule.findMany({
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

  const title = possessiveTitle("Capsules", firstName);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">Curated sets — pack lists, capsule wardrobes, themes.</p>
        </div>
        <Link href="/capsules/new" className="btn-primary">+ New</Link>
      </div>

      {capsules.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl" aria-hidden>🎒</div>
          <p className="mt-3 font-display text-2xl text-blush-700">No capsules yet</p>
          <p className="mt-1 text-stone-600">Group pieces around a trip, season, or vibe — Paris, Summer, Date night.</p>
          <Link href="/capsules/new" className="btn-primary mt-4 inline-flex">Build your first capsule</Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {capsules.map((c) => (
            <li key={c.id}>
              <Link href={`/capsules/${c.id}`} className="card block overflow-hidden transition hover:shadow-md">
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
                  <p className="truncate font-display text-lg text-stone-800">{c.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {[c.occasion, c.season].filter(Boolean).join(" · ") || "—"}
                    <span className="text-stone-300"> · </span>
                    {c._count.items} piece{c._count.items === 1 ? "" : "s"}
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
