import { prisma } from "@/lib/db";
import OutfitBuilder from "./OutfitBuilder";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const items = await prisma.item.findMany({
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-blush-700">Build an outfit</h1>
        <p className="text-sm text-stone-500">Pick a piece for each slot, or hit Surprise me.</p>
      </div>
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
    </div>
  );
}
