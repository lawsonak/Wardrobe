import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ClosetGallery from "../ClosetGallery";
import { BEAUTY_CATEGORIES, BEAUTY_CATEGORY_GROUPS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// 💄 — the dedicated home for `isBeauty = true` items (cosmetics,
// skincare, fragrance, tools). Reached from the 💄 icon in the main
// closet header; the closet itself otherwise has zero references to
// these items (no toggles, no filters). Mirrors the Spicy /
// /wardrobe/backroom pattern.
//
// Filter + search mirror the main closet's pattern (chips, ★ favorites,
// free-text q) but use BEAUTY_CATEGORIES (~30 entries) sectioned by
// the six logical groups (Lips / Eyes / Face / Skincare / Tools /
// Fragrance) so the chip row stays scannable.
//
// isBackroom items are NOT excluded here — beauty + spicy is a valid
// combination (e.g. costume body paint), and the user can hop to
// /wardrobe/backroom for the spicy view.
export default async function BeautyPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; fav?: string; q?: string; group?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const category =
    sp.category && (BEAUTY_CATEGORIES as readonly string[]).includes(sp.category)
      ? sp.category
      : undefined;
  // Group filter (Lips / Eyes / Face / Skincare / Tools / Fragrance)
  // — when set, narrows the gallery to any category in that group.
  // Useful when the user wants "show me all my eye stuff" without
  // pinning a specific category.
  const group = sp.group
    ? BEAUTY_CATEGORY_GROUPS.find((g) => g.label.toLowerCase() === sp.group?.toLowerCase())
    : undefined;
  const groupCategories = group ? group.categories.slice() : null;

  const favOnly = sp.fav === "1";
  const q = sp.q?.trim();

  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      isBeauty: true,
      status: { not: "draft" },
      ...(category ? { category } : {}),
      ...(groupCategories && !category ? { category: { in: groupCategories } } : {}),
      ...(favOnly ? { isFavorite: true } : {}),
      ...(q
        ? {
            OR: [
              { subType: { contains: q } },
              { brand: { contains: q } },
              { color: { contains: q } },
              { shadeName: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      color: true,
      isFavorite: true,
      shadeName: true,
      shadeHex: true,
    },
  });

  // Total (unfiltered) count for the subtitle so the user can see how
  // many beauty items exist even when filtering down to zero.
  const total = await prisma.item.count({
    where: { ownerId: userId, isBeauty: true, status: { not: "draft" } },
  });

  const activeFilters: { label: string; href: string }[] = [];
  if (category) activeFilters.push({ label: category, href: dropParam(sp, "category") });
  if (group && !category)
    activeFilters.push({ label: group.label, href: dropParam(sp, "group") });
  if (favOnly) activeFilters.push({ label: "favorites", href: dropParam(sp, "fav") });
  if (q) activeFilters.push({ label: `"${q}"`, href: dropParam(sp, "q") });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">💄</h1>
          <p className="text-sm text-stone-500">
            {items.length === total
              ? `${total} item${total === 1 ? "" : "s"}`
              : `${items.length} of ${total}`}{" "}
            kept separate from the main closet, outfit builder, and AI prompts.
          </p>
        </div>
        <Link href="/wardrobe/new?beauty=1" className="btn-primary whitespace-nowrap">
          + Add
        </Link>
      </div>

      {/* Plain text-search form — same shape as /wardrobe/backroom.
          Form GETs the page so the URL stays bookmarkable. */}
      <form action="/wardrobe/beauty" className="flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search shade, brand, name…"
          className="input flex-1"
        />
        {category && <input type="hidden" name="category" value={category} />}
        {group && !category && <input type="hidden" name="group" value={group.label} />}
        {favOnly && <input type="hidden" name="fav" value="1" />}
        <button type="submit" className="btn-secondary">Go</button>
      </form>

      {/* Group chips (six total). When a group is on, the per-category
          chips below filter inside that group. The chip row stays
          short until the user dives into a section. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={favOnly ? dropParam(sp, "fav") : `/wardrobe/beauty?${withParam(sp, "fav", "1")}`}
          className={"chip " + (favOnly ? "chip-on" : "chip-off")}
        >
          ★ Favorites
        </Link>
        {BEAUTY_CATEGORY_GROUPS.map((g) => {
          const on = group?.label === g.label;
          // When switching to a different group, drop any pinned
          // category from the previous group (it won't apply
          // anyway). Build by hand because dropParam returns a URL
          // string, not the param record withParam wants.
          const switched: Record<string, string | undefined> = { ...sp, category: undefined };
          const href = on
            ? dropParam(sp, "group")
            : `/wardrobe/beauty?${withParam(switched, "group", g.label)}`;
          return (
            <Link
              key={g.label}
              href={href}
              className={"chip " + (on ? "chip-on" : "chip-off")}
            >
              {g.label}
            </Link>
          );
        })}
      </div>

      {/* Per-category chips. When a group is selected, only show
          chips inside that group; otherwise stay collapsed behind a
          More-categories disclosure to keep the page tight. */}
      {group && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {group.categories.map((c) => {
            const on = category === c;
            const href = on
              ? dropParam(sp, "category")
              : `/wardrobe/beauty?${withParam(sp, "category", c)}`;
            return (
              <Link
                key={c}
                href={href}
                className={"chip " + (on ? "chip-on" : "chip-off")}
              >
                {c}
              </Link>
            );
          })}
        </div>
      )}

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

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>💄</div>
          {total === 0 ? (
            <>
              <p className="mt-3 font-display text-2xl text-blush-700">Nothing here yet.</p>
              <p className="mt-1 text-stone-600">
                Add a beauty item with the <strong>+ Add</strong> button — cosmetics,
                skincare, tools, or fragrance. They&rsquo;ll live here, kept separate
                from the main closet and AI outfit prompts.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 font-display text-2xl text-blush-700">Nothing matches.</p>
              <p className="mt-1 text-stone-600">Try clearing a filter or rephrasing your search.</p>
              <Link href="/wardrobe/beauty" className="btn-secondary mt-4 inline-flex">Clear filters</Link>
            </>
          )}
        </div>
      ) : (
        <ClosetGallery items={items} />
      )}
    </div>
  );
}

function withParam(sp: Record<string, string | undefined>, key: string, value: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  u.set(key, value);
  return u.toString();
}

function dropParam(
  sp: Record<string, string | undefined>,
  key: string,
  asUrl: boolean = true,
): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  const qs = u.toString();
  if (!asUrl) return qs;
  return qs ? `/wardrobe/beauty?${qs}` : "/wardrobe/beauty";
}
