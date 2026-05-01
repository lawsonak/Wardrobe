import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ACTIVITIES, SEASONS, SLOTS } from "@/lib/constants";
import OutfitCard from "@/components/OutfitCard";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";

export const dynamic = "force-dynamic";

export default async function OutfitsPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string; season?: string; fav?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const firstName = firstNameFromUser(session?.user);

  const outfits = await prisma.outfit.findMany({
    where: {
      ...(sp.activity ? { activity: sp.activity } : {}),
      ...(sp.season ? { season: sp.season } : {}),
      ...(sp.fav === "1" ? { isFavorite: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { items: { include: { item: true } } },
  });

  const title = possessiveTitle("Outfits", firstName);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">{outfits.length} saved</p>
        </div>
        <Link href="/outfits/builder" className="btn-primary">+ Build</Link>
      </div>

      <form action="/outfits" className="flex flex-wrap gap-2">
        <select name="activity" defaultValue={sp.activity ?? ""} className="input w-auto">
          <option value="">All activities</option>
          {ACTIVITIES.map((a) => (
            <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
          ))}
        </select>
        <select name="season" defaultValue={sp.season ?? ""} className="input w-auto">
          <option value="">All seasons</option>
          {SEASONS.map((s) => (
            <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <label className="chip chip-off cursor-pointer">
          <input type="checkbox" name="fav" value="1" defaultChecked={sp.fav === "1"} className="mr-1" />
          Favorites
        </label>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      {outfits.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-2xl text-blush-700">No outfits yet</p>
          <p className="mt-1 text-stone-600">Mix and match your pieces to save your first look.</p>
          <Link href="/outfits/builder" className="btn-primary mt-4 inline-flex">Build an outfit</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {outfits.map((o) => (
            <OutfitCard
              key={o.id}
              outfit={{
                id: o.id,
                name: o.name,
                activity: o.activity,
                season: o.season,
                isFavorite: o.isFavorite,
                tryOnImagePath: o.tryOnImagePath,
                items: o.items.map((oi) => ({
                  slot: oi.slot,
                  item: {
                    id: oi.item.id,
                    imagePath: oi.item.imagePath,
                    imageBgRemovedPath: oi.item.imageBgRemovedPath,
                    category: oi.item.category,
                    subType: oi.item.subType,
                  },
                }))}
              }
              slotsOrder={[...SLOTS]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
