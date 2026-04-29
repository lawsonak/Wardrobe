import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";
import WishlistCard from "./WishlistCard";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const items = await prisma.wishlistItem.findMany({
    where: { ownerId: userId },
    orderBy: [{ purchased: "asc" }, { createdAt: "desc" }],
  });

  const active = items.filter((i) => !i.purchased);
  const purchased = items.filter((i) => i.purchased);

  const title = possessiveTitle("Wishlist", firstName);

  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedActive = [...active].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">
            {active.length} item{active.length === 1 ? "" : "s"} to find
            {purchased.length > 0 && ` · ${purchased.length} purchased`}
          </p>
        </div>
        <Link href="/wishlist/new" className="btn-primary">+ Add</Link>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>💝</div>
          <p className="mt-3 font-display text-2xl text-blush-700">
            {firstName ? `Start a wishlist, ${firstName}.` : "Start a wishlist."}
          </p>
          <p className="mt-1 text-stone-600">Birthday hints, vacation dreams, or pieces you keep eyeing.</p>
          <Link href="/wishlist/new" className="btn-primary mt-4 inline-flex">Add your first wish</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedActive.length > 0 && (
            <section>
              <div className="space-y-3">
                {sortedActive.map((item) => (
                  <WishlistCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {purchased.length > 0 && (
            <section>
              <h2 className="font-display text-lg text-stone-500 mb-3">Purchased</h2>
              <div className="space-y-3 opacity-60">
                {purchased.map((item) => (
                  <WishlistCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
