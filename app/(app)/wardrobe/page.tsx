import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/constants";
import { firstNameFromUser } from "@/lib/userName";
import SmartSearchBar from "./SmartSearchBar";
import ClosetGallery from "./ClosetGallery";
import { inferredCategoriesFor } from "@/lib/activities";

export const dynamic = "force-dynamic";

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
  }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const category = sp.category && CATEGORIES.includes(sp.category as Category) ? sp.category : undefined;
  const favOnly = sp.fav === "1";
  const q = sp.q?.trim();
  const statusFilter = sp.status;
  // "Unlabeled" surfaces items still waiting for tagging — produced
  // by the bulk upload flow before AI runs (status=needs_review) or
  // by anyone uploading with the AI off. Implemented as a one-tap
  // quick filter that just rewrites the existing status query param.
  const unlabeledOnly = statusFilter === "needs_review";
  const color = sp.color?.trim() || undefined;
  const season = sp.season?.trim() || undefined;
  const activity = sp.activity?.trim() || undefined;

  // Activity filter pulls in categories that strongly imply that
  // activity — e.g. "beach" surfaces every Swimwear item even when
  // no one has tagged it explicitly.
  const activityClause = activity
    ? (() => {
        const inferred = inferredCategoriesFor(activity);
        if (inferred.length === 0) {
          return { activities: { contains: activity } };
        }
        return {
          OR: [
            { activities: { contains: activity } },
            { category: { in: inferred } },
          ],
        };
      })()
    : null;

  // Build the strict WHERE clause once so the loose-match fallback can
  // selectively drop pieces of it without re-deriving everything.
  const filterLabels: Record<string, string> = {
    color: color ? color : "",
    activity: activity ? activity : "",
    season: season ? season : "",
    q: q ? `"${q}"` : "",
    category: category ? category : "",
  };
  const buildWhere = (drop: Set<string>) => ({
    ownerId: userId,
    ...(!drop.has("category") && category ? { category } : {}),
    ...(favOnly ? { isFavorite: true } : {}),
    ...(statusFilter ? { status: statusFilter } : { status: "active" }),
    ...(!drop.has("color") && color ? { color } : {}),
    ...(!drop.has("season") && season ? { seasons: { contains: season } } : {}),
    ...(!drop.has("activity") && activityClause ? activityClause : {}),
    ...(!drop.has("q") && q
      ? {
          OR: [
            { subType: { contains: q } },
            { brand: { contains: q } },
            { color: { contains: q } },
            { notes: { contains: q } },
          ],
        }
      : {}),
  });

  // Always show how many items are unlabeled so the pill carries a
  // badge even when the filter isn't active. Cheap COUNT query, owner-
  // scoped, fires in parallel with the gallery fetch below.
  const select = {
    id: true,
    imagePath: true,
    imageBgRemovedPath: true,
    category: true,
    subType: true,
    color: true,
    isFavorite: true,
  } as const;

  const [unlabeledCount, strictItems] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId, status: "needs_review" } }),
    prisma.item.findMany({
      where: buildWhere(new Set()),
      select,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Loose-match fallback: when the strict query returns nothing AND a
  // narrowing filter is set, drop one filter at a time until results
  // appear or only the user's most-likely intent (category, favorites,
  // unlabeled) remains. Drop order is "most variable" first — color
  // and activity rarely match exactly, free text and category are
  // closer to user intent. Drop is never to less than ownerId+status.
  let items = strictItems;
  let droppedFilter: string | null = null;
  if (items.length === 0) {
    const dropOrder = ["color", "activity", "season", "q"];
    const dropped = new Set<string>();
    for (const key of dropOrder) {
      if (!filterLabels[key]) continue;
      dropped.add(key);
      const next = await prisma.item.findMany({
        where: buildWhere(dropped),
        select,
        orderBy: { createdAt: "desc" },
      });
      if (next.length > 0) {
        items = next;
        droppedFilter = key;
        break;
      }
    }
  }

  const filtered = items;
  // Human-friendly notice for the loose-match banner.
  const looseMatchBanner = droppedFilter
    ? (() => {
        const dropped = filterLabels[droppedFilter];
        const what = droppedFilter === "q" ? `text match` : droppedFilter;
        return `No exact matches for ${dropped ? dropped + " " : ""}— showing close-enough results without the ${what} filter.`;
      })()
    : null;

  const title = "Closet";
  const activeFilters: { label: string; href: string }[] = [];
  if (category) activeFilters.push({ label: category, href: dropParam(sp, "category") });
  if (color) activeFilters.push({ label: color, href: dropParam(sp, "color") });
  if (season) activeFilters.push({ label: season, href: dropParam(sp, "season") });
  if (activity) activeFilters.push({ label: activity, href: dropParam(sp, "activity") });
  if (favOnly) activeFilters.push({ label: "favorites", href: dropParam(sp, "fav") });
  if (unlabeledOnly) activeFilters.push({ label: "unlabeled", href: dropParam(sp, "status") });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-blush-700">{title}</h1>
          <p className="text-sm text-stone-500">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/wardrobe/new" className="btn-primary">+ Add</Link>
          <Link href="/wardrobe/bulk" className="btn-secondary text-xs">Import</Link>
        </div>
      </div>

      <SmartSearchBar initialQuery={q ?? ""} hasItems={items.length > 0} />

      {/* One-tap quick filters. Sit right under the search bar so they
          double as visible affordances for "what kinds of slices does
          this view support". */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={favOnly ? dropParam(sp, "fav") : `/wardrobe?${withParam(sp, "fav", "1")}`}
          className={"chip " + (favOnly ? "chip-on" : "chip-off")}
        >
          ★ Favorites
        </Link>
        <Link
          href={unlabeledOnly ? dropParam(sp, "status") : `/wardrobe?${withParam(sp, "status", "needs_review")}`}
          className={"chip " + (unlabeledOnly ? "chip-on" : "chip-off")}
          title="Items waiting for AI tags or manual cleanup"
        >
          Unlabeled
          {unlabeledCount > 0 && (
            <span className={"ml-1 rounded-full px-1.5 text-[10px] " + (unlabeledOnly ? "bg-white/25 text-white" : "bg-stone-100 text-stone-500")}>
              {unlabeledCount}
            </span>
          )}
        </Link>
      </div>

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

      {looseMatchBanner && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          {looseMatchBanner}
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
        <ClosetGallery items={filtered} />
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

// Build the query string with one parameter set/replaced. Used by the
// quick-filter pills so toggling them preserves any other active filters.
function withParam(sp: Record<string, string | undefined>, key: string, value: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  u.set(key, value);
  return u.toString();
}
