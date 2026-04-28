import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getFirstName } from "@/lib/constants";
import ItemCard from "@/components/ItemCard";
import GiftBanner from "@/components/GiftBanner";
import OnboardingCard from "@/components/OnboardingCard";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = getFirstName(session?.user?.name, session?.user?.email);
  const name = firstName || "there";

  const [recent, favorites, outfitCount, itemCount, needsReviewCount, wishlistCount] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId, status: "active" },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.item.findMany({
      where: { ownerId: userId, isFavorite: true, status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.outfit.count({ where: { ownerId: userId } }),
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.item.count({ where: { ownerId: userId, status: "needs_review" } }),
    prisma.wishlistItem.count({ where: { ownerId: userId, purchased: false } }),
  ]);

  const isFirstTime = itemCount === 0 && outfitCount === 0;

  return (
    <div className="space-y-8">
      <GiftBanner />

      {/* Hero greeting */}
      <section>
        <p className="text-sm uppercase tracking-widest text-stone-500">Hello,</p>
        <h1 className="font-display text-4xl text-blush-700">{name}</h1>
        <p className="mt-1 text-stone-600">
          {itemCount === 0
            ? "Your closet is waiting. Add your first piece to begin."
            : `${itemCount} item${itemCount === 1 ? "" : "s"} · ${outfitCount} outfit${outfitCount === 1 ? "" : "s"}`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wardrobe/new" className="btn-primary">+ Add item</Link>
          {itemCount > 0 && (
            <Link href="/outfits/builder" className="btn-secondary">Build an outfit</Link>
          )}
        </div>
      </section>

      {/* Alert cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {needsReviewCount > 0 && (
          <Link href="/wardrobe/needs-review" className="card flex items-center gap-3 p-4 hover:shadow-md transition-shadow">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-stone-800">{needsReviewCount} item{needsReviewCount === 1 ? "" : "s"} need review</p>
              <p className="text-xs text-stone-500">Tap to fill in missing details</p>
            </div>
            <svg className="ml-auto h-4 w-4 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        )}

        {wishlistCount > 0 && (
          <Link href="/wishlist" className="card flex items-center gap-3 p-4 hover:shadow-md transition-shadow">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-stone-800">{wishlistCount} wish{wishlistCount === 1 ? "" : "es"} saved</p>
              <p className="text-xs text-stone-500">View your wishlist</p>
            </div>
            <svg className="ml-auto h-4 w-4 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        )}
      </div>

      {/* Onboarding card for new users */}
      {isFirstTime && <OnboardingCard />}

      {/* Favorites */}
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

      {/* Recently added */}
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

      {/* Closet stats */}
      {itemCount > 0 && (
        <section className="card p-4">
          <h2 className="font-display text-lg text-stone-800 mb-3">Closet stats</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="font-display text-2xl text-blush-700">{itemCount}</p>
              <p className="text-xs text-stone-500">Items</p>
            </div>
            <div>
              <p className="font-display text-2xl text-blush-700">{outfitCount}</p>
              <p className="text-xs text-stone-500">Outfits</p>
            </div>
            <div>
              <p className="font-display text-2xl text-blush-700">{favorites.length}</p>
              <p className="text-xs text-stone-500">Favorites</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
