import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { csvToList } from "@/lib/constants";
import { firstNameFromUser } from "@/lib/userName";
import NeedsReviewItem from "./NeedsReviewItem";

export const dynamic = "force-dynamic";

export default async function NeedsReviewPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      status: "needs_review",
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
          <h1 className="font-display text-3xl text-blush-700 mt-1">Needs Review</h1>
          <p className="text-sm text-stone-500">{items.length} item{items.length === 1 ? "" : "s"} waiting</p>
        </div>
        <Link href="/wardrobe/new" className="btn-primary">+ Add</Link>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-2xl text-blush-700">All caught up!</p>
          <p className="mt-1 text-stone-600">No items need review right now.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/wardrobe" className="btn-secondary">Browse closet</Link>
            <Link href="/wardrobe/new" className="btn-primary">Add an item</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-500">
            These items were added quickly or are missing details.
            {firstName ? ` Fill them in when you have a moment, ${firstName}.` : " Fill them in when you have a moment."}
          </p>
          {items.map((item) => (
            <NeedsReviewItem
              key={item.id}
              item={{
                id: item.id,
                imagePath: item.imagePath,
                imageBgRemovedPath: item.imageBgRemovedPath,
                category: item.category,
                subType: item.subType,
                brand: item.brand,
                size: item.size,
                color: item.color,
                seasons: csvToList(item.seasons),
                activities: csvToList(item.activities),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
