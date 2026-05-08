import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import OutfitBuilder from "./OutfitBuilder";
import { backroomItemFilter, readBackroomParam } from "@/lib/backroom";

export const dynamic = "force-dynamic";

export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ backroom?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const sp = await searchParams;
  const includeBackroom = readBackroomParam(sp.backroom);

  // Owner-scope guard: without ownerId, the builder picker leaked
  // every other user's active items into the slot grid.
  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active", ...backroomItemFilter(includeBackroom) },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">Build an outfit</h1>
          <p className="text-sm text-stone-500">Pick a piece for each slot, or hit Surprise me.</p>
        </div>
        <Link
          href={includeBackroom ? "/outfits/builder" : "/outfits/builder?backroom=1"}
          className={"chip text-xs " + (includeBackroom ? "chip-on" : "chip-off")}
          title={includeBackroom ? "Hide 🌶 items from the picker" : "Include 🌶 items in the picker"}
        >
          🌶
        </Link>
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
          includeBackroom={includeBackroom}
        />
      </Suspense>
    </div>
  );
}
