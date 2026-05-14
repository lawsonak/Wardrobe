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
  const [items, looks] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId, status: "active", isBeauty: false, ...backroomItemFilter(includeBackroom) },
      orderBy: { createdAt: "desc" },
    }),
    // Looks for the optional "Pair with a Look" picker. Card-shaped
    // projection — only the bits the sheet renders.
    prisma.look.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        items: {
          take: 4,
          select: {
            item: {
              select: {
                id: true,
                imagePath: true,
                imageBgRemovedPath: true,
                shadeHex: true,
              },
            },
          },
        },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const availableLooks = looks.map((l) => ({
    id: l.id,
    name: l.name,
    itemCount: l._count.items,
    thumbs: l.items.map(({ item }) => ({
      id: item.id,
      src: item.imageBgRemovedPath
        ? `/api/uploads/${item.imageBgRemovedPath}`
        : `/api/uploads/${item.imagePath}`,
      shadeHex: item.shadeHex,
    })),
  }));
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
          availableLooks={availableLooks}
        />
      </Suspense>
    </div>
  );
}
