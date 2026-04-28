import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category, getFirstName } from "@/lib/constants";
import ItemCard from "@/components/ItemCard";

export const dynamic = "force-dynamic";

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; fav?: string; q?: string; status?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const firstName = getFirstName(session?.user?.name, session?.user?.email);
  const category = sp.category && CATEGORIES.includes(sp.category as Category) ? sp.category : undefined;
  const favOnly = sp.fav === "1";
  const q = sp.q?.trim();
  const statusFilter = sp.status;

  const items = await prisma.item.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(favOnly ? { isFavorite: true } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q
        ? {
            OR: [
              { subType: { contains: q } },
              { brand: { contains: q } },
              { color: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const title = firstName ? `${firstName}'s Closet` : "Closet";

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">{items.length} item{items.length === 1 ? "" : "s"}</p>
        </div>
        <Link href="/wardrobe/new" className="btn-primary">+ Add</Link>
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/wardrobe">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name, brand, color…"
          className="input flex-1 min-w-[14rem]"
        />
        <select name="category" defaultValue={category ?? ""} className="input w-auto">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="chip chip-off cursor-pointer">
          <input type="checkbox" name="fav" value="1" defaultChecked={favOnly} className="mr-1" />
          Favorites
        </label>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-2xl text-blush-700">Nothing here yet</p>
          <p className="mt-1 text-stone-600">Add your first piece to start your collection.</p>
          <Link href="/wardrobe/new" className="btn-primary mt-4 inline-flex">+ Add an item</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} href={`/wardrobe/${item.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
