import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/constants";
import ItemCard from "@/components/ItemCard";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";
import SmartSearchBar from "./SmartSearchBar";
import { lastWearISO, daysSince } from "@/lib/wear";

export const dynamic = "force-dynamic";

const DORMANT_THRESHOLD_DAYS = 60;

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    fav?: string;
    q?: string;
    status?: string;
    color?: string;
    season?: string;
    activity?: string;
    dormant?: string;
  }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const category = sp.category && CATEGORIES.includes(sp.category as Category) ? sp.category : undefined;
  const favOnly = sp.fav === "1";
  const q = sp.q?.trim();
  const statusFilter = sp.status;
  const color = sp.color?.trim() || undefined;
  const season = sp.season?.trim() || undefined;
  const activity = sp.activity?.trim() || undefined;
  const dormantOnly = sp.dormant === "1";

  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      ...(category ? { category } : {}),
      ...(favOnly ? { isFavorite: true } : {}),
      ...(statusFilter ? { status: statusFilter } : { status: "active" }),
      ...(color ? { color } : {}),
      ...(season ? { seasons: { contains: season } } : {}),
      ...(activity ? { activities: { contains: activity } } : {}),
      ...(q
        ? {
            OR: [
              { subType: { contains: q } },
              { brand: { contains: q } },
              { color: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  // Dormant filter is computed in JS because the wear stamp lives in
  // notes (no schema migration). Cheap for closets up to a few thousand
  // items, which a personal wardrobe will never hit.
  const filtered = dormantOnly
    ? items.filter((it) => {
        const lastWore = lastWearISO(it.notes);
        const isoDate = lastWore ?? it.updatedAt.toISOString().slice(0, 10);
        return daysSince(isoDate) >= DORMANT_THRESHOLD_DAYS;
      })
    : items;

  const title = possessiveTitle("Closet", firstName);
  const activeFilters: { label: string; href: string }[] = [];
  if (category) activeFilters.push({ label: category, href: dropParam(sp, "category") });
  if (color) activeFilters.push({ label: color, href: dropParam(sp, "color") });
  if (season) activeFilters.push({ label: season, href: dropParam(sp, "season") });
  if (activity) activeFilters.push({ label: activity, href: dropParam(sp, "activity") });
  if (favOnly) activeFilters.push({ label: "favorites", href: dropParam(sp, "fav") });
  if (dormantOnly) activeFilters.push({ label: "haven't worn", href: dropParam(sp, "dormant") });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
            {dormantOnly ? " not worn lately" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/wardrobe/new" className="btn-primary">+ Add</Link>
          <Link href="/wardrobe/bulk" className="btn-secondary text-xs">Import</Link>
        </div>
      </div>

      <SmartSearchBar initialQuery={q ?? ""} hasItems={items.length > 0} />

      {/* Quick taxonomy filter (form, kept for keyboard-only / no-AI users) */}
      <details className="card p-3 text-sm">
        <summary className="cursor-pointer select-none text-stone-600">More filters</summary>
        <form className="mt-3 flex flex-wrap items-center gap-2" action="/wardrobe">
          <select name="category" defaultValue={category ?? ""} className="input w-auto">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="chip chip-off cursor-pointer">
            <input type="checkbox" name="fav" value="1" defaultChecked={favOnly} className="mr-1" />
            Favorites
          </label>
          <label className="chip chip-off cursor-pointer">
            <input type="checkbox" name="dormant" value="1" defaultChecked={dormantOnly} className="mr-1" />
            Haven&apos;t worn lately
          </label>
          <button className="btn-secondary" type="submit">Apply</button>
        </form>
      </details>

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

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          {items.length === 0 ? (
            <>
              <p className="font-display text-2xl text-blush-700">
                {firstName ? `Welcome, ${firstName}.` : "Your closet is waiting."}
              </p>
              <p className="mt-1 text-stone-600">Snap your first piece — tags can wait.</p>
              <Link href="/wardrobe/new" className="btn-primary mt-4 inline-flex">+ Add an item</Link>
            </>
          ) : (
            <>
              <p className="font-display text-2xl text-blush-700">Nothing matches</p>
              <p className="mt-1 text-stone-600">Try clearing a filter or rephrasing your search.</p>
              <Link href="/wardrobe" className="btn-secondary mt-4 inline-flex">Clear filters</Link>
            </>
          )}
        </div>
      ) : (
        <div className="-mx-1 grid grid-cols-4 gap-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
          {filtered.map((item) => {
            const tags: string[] = [];
            if (dormantOnly) {
              const lastWore = lastWearISO(item.notes);
              const iso = lastWore ?? item.updatedAt.toISOString().slice(0, 10);
              tags.push(`${daysSince(iso)}d`);
            }
            return (
              <div key={item.id} className="space-y-0.5">
                <ItemCard item={item} href={`/wardrobe/${item.id}`} compact />
                {tags.length > 0 && (
                  <p className="px-1 text-[10px] uppercase tracking-wide text-stone-400">{tags.join(" · ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Build the URL string with one parameter dropped.
function dropParam(sp: Record<string, string | undefined>, key: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  const qs = u.toString();
  return qs ? `/wardrobe?${qs}` : "/wardrobe";
}
