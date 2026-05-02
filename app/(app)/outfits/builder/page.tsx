import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import OutfitBuilder from "./OutfitBuilder";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  // Owner-scope guard: without ownerId, the builder picker leaked
  // every other user's active items into the slot grid.
  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-blush-700">Build an outfit</h1>
        <p className="text-sm text-stone-500">Pick a piece for each slot, or hit Surprise me.</p>
      </div>
      <Suspense>
        <OutfitBuilder
          items={items.map((i) => ({
            id: i.id,
            imagePath: i.imagePath,
            imageBgRemovedPath: i.imageBgRemovedPath,
            category: i.category,
            subType: i.subType,
            color: i.color,
            isFavorite: i.isFavorite,
            seasons: i.seasons,
            activities: i.activities,
          }))}
        />
      </Suspense>
    </div>
  );
}
