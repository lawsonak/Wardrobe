import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ItemCard from "@/components/ItemCard";
import GiftBanner from "@/components/GiftBanner";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  const name = session?.user?.name?.split(" ")[0] ?? "there";

  const [recent, favorites, outfitCount, itemCount] = await Promise.all([
    prisma.item.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.item.findMany({ where: { isFavorite: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.outfit.count(),
    prisma.item.count(),
  ]);

  return (
    <div className="space-y-8">
      <GiftBanner />

      <section>
        <p className="text-sm uppercase tracking-widest text-stone-500">Hello,</p>
        <h1 className="font-display text-4xl text-blush-700">{name}</h1>
        <p className="mt-1 text-stone-600">
          {itemCount === 0
            ? "Your closet is waiting. Add your first piece to begin."
            : `You have ${itemCount} item${itemCount === 1 ? "" : "s"} and ${outfitCount} saved outfit${outfitCount === 1 ? "" : "s"}.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wardrobe/new" className="btn-primary">+ Add an item</Link>
          <Link href="/outfits/builder" className="btn-secondary">Build an outfit</Link>
        </div>
      </section>

      {favorites.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-2xl text-stone-800">Favorites</h2>
            <Link href="/wardrobe?fav=1" className="text-sm text-blush-600 hover:underline">See all</Link>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {favorites.map((item) => (
              <div key={item.id} className="w-32 shrink-0">
                <ItemCard item={item} href={`/wardrobe/${item.id}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-2xl text-stone-800">Recently added</h2>
            <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">See all</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {recent.slice(0, 4).map((item) => (
              <ItemCard key={item.id} item={item} href={`/wardrobe/${item.id}`} />
            ))}
          </div>
        </section>
      )}

      {itemCount === 0 && (
        <section className="card p-8 text-center">
          <p className="font-display text-2xl text-blush-700">Let&apos;s get started</p>
          <p className="mt-1 text-stone-600">Snap a photo of your favorite piece and tag it however you like.</p>
          <Link href="/wardrobe/new" className="btn-primary mt-4 inline-flex">Add your first item</Link>
        </section>
      )}
    </div>
  );
}
