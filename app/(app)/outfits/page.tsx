import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ACTIVITIES, SEASONS, SLOTS } from "@/lib/constants";
import OutfitCard from "@/components/OutfitCard";
import { firstNameFromUser } from "@/lib/userName";

export const dynamic = "force-dynamic";

export default async function OutfitsPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string; season?: string; fav?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const outfits = await prisma.outfit.findMany({
    where: {
      // Owner-scope guard: never leak another user's outfits, even
      // when filters are wide-open. An empty userId still produces an
      // empty result set since no row's ownerId is "".
      ownerId: userId,
      ...(sp.activity ? { activity: sp.activity } : {}),
      ...(sp.season ? { season: sp.season } : {}),
      ...(sp.fav === "1" ? { isFavorite: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { items: { include: { item: true } } },
  });

  const title = "Outfits";

  // Active-filter chips mirror the wardrobe page pattern so the user
  // can see what's filtered and tap × on a chip to remove it without
  // re-submitting the form. Same shape, same dropParam helper.
  const activeFilters: { label: string; href: string }[] = [];
  if (sp.activity) activeFilters.push({ label: sp.activity, href: dropParam(sp, "activity") });
  if (sp.season) activeFilters.push({ label: sp.season, href: dropParam(sp, "season") });
  if (sp.fav === "1") activeFilters.push({ label: "favorites", href: dropParam(sp, "fav") });

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

      {activeFilters.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span>Filtering by:</span>
          {activeFilters.map((f) => (
            <Link key={f.label} href={f.href} className="chip chip-off pr-2">
              {f.label}
              <span aria-hidden className="ml-1 text-stone-400">×</span>
              <span className="sr-only">Remove filter</span>
            </Link>
          ))}
        </div>
      )}

      {outfits.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>👗</div>
          <p className="mt-3 font-display text-2xl text-blush-700">
            {firstName ? `Build your first look, ${firstName}.` : "Build your first look."}
          </p>
          <p className="mt-1 text-stone-600">Mix and match a few favorites — or let AI suggest something.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link href="/outfits/builder" className="btn-primary">Build an outfit</Link>
            <Link href="/outfits/builder?shuffle=1" className="btn-secondary">✨ Surprise me</Link>
          </div>
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

function dropParam(sp: Record<string, string | undefined>, key: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  const qs = u.toString();
  return qs ? `/outfits?${qs}` : "/outfits";
}
