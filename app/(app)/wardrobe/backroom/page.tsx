import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ClosetGallery from "../ClosetGallery";
import { SPICY_CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

// 🌶 — the dedicated home for `isBackroom = true` items. Reached
// from the 🌶 icon in the main closet header; the closet itself
// otherwise has zero references to these items (no toggles, no
// filters). Keeping this fully separate means a passing glance at the
// main /wardrobe URL never surfaces intimates.
//
// Search + filter mirror the main closet's pattern (category chips,
// ★ favorites, free-text q) but operate exclusively over isBackroom
// items and use SPICY_CATEGORIES (Lingerie, Costume, Toys, …) instead
// of the main 14.
export default async function BackroomPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; fav?: string; q?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const category =
    sp.category && (SPICY_CATEGORIES as readonly string[]).includes(sp.category)
      ? sp.category
      : undefined;
  const favOnly = sp.fav === "1";
  const q = sp.q?.trim();

  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      isBackroom: true,
      status: { not: "draft" },
      ...(category ? { category } : {}),
      ...(favOnly ? { isFavorite: true } : {}),
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
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      color: true,
      isFavorite: true,
    },
  });

  // Total (unfiltered) count for the subtitle, so the user can see
  // how many spicy items exist even when filtering down to zero.
  const total = await prisma.item.count({
    where: { ownerId: userId, isBackroom: true, status: { not: "draft" } },
  });

  const activeFilters: { label: string; href: string }[] = [];
  if (category) activeFilters.push({ label: category, href: dropParam(sp, "category") });
  if (favOnly) activeFilters.push({ label: "favorites", href: dropParam(sp, "fav") });
  if (q) activeFilters.push({ label: `"${q}"`, href: dropParam(sp, "q") });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">🌶</h1>
          <p className="text-sm text-stone-500">
            {items.length === total
              ? `${total} item${total === 1 ? "" : "s"}`
              : `${items.length} of ${total}`} kept separate from the main closet, outfit builder, and AI prompts.
          </p>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Link href="/wardrobe/new?backroom=1" className="btn-primary">+ Add</Link>
          <Link
            href="/wardrobe/new/split?backroom=1"
            className="btn-secondary text-xs"
            title="AI splits one photo of multiple items into separate closet entries"
          >
            ✂ Split
          </Link>
        </div>
      </div>

      {/* Plain text-search form — no AI parsing, just the same
          contains-matches the main closet falls back on. Form GETs
          the page so the URL stays bookmarkable. */}
      <form action="/wardrobe/backroom" className="flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search…"
          className="input flex-1"
        />
        {/* Preserve other filters across submit so the search input
            doesn't inadvertently clear category / favorites. */}
        {category && <input type="hidden" name="category" value={category} />}
        {favOnly && <input type="hidden" name="fav" value="1" />}
        <button type="submit" className="btn-secondary">Go</button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={favOnly ? dropParam(sp, "fav") : `/wardrobe/backroom?${withParam(sp, "fav", "1")}`}
          className={"chip " + (favOnly ? "chip-on" : "chip-off")}
        >
          ★ Favorites
        </Link>
        {SPICY_CATEGORIES.map((c) => {
          const on = category === c;
          const href = on
            ? dropParam(sp, "category")
            : `/wardrobe/backroom?${withParam(sp, "category", c)}`;
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
          <div className="text-4xl" aria-hidden>🌶</div>
          {total === 0 ? (
            <>
              <p className="mt-3 font-display text-2xl text-blush-700">Nothing here yet.</p>
              <p className="mt-1 text-stone-600">
                Toggle 🌶 on any item&rsquo;s edit page to send it here — kept
                out of the main closet, outfit builder, collection picker,
                and AI prompts.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 font-display text-2xl text-blush-700">Nothing matches.</p>
              <p className="mt-1 text-stone-600">Try clearing a filter or rephrasing your search.</p>
              <Link href="/wardrobe/backroom" className="btn-secondary mt-4 inline-flex">Clear filters</Link>
            </>
          )}
        </div>
      ) : (
        <ClosetGallery items={items} />
      )}
    </div>
  );
}

// Compose a URL string with one extra parameter, preserving the
// existing ones so chip taps stack cleanly.
function withParam(sp: Record<string, string | undefined>, key: string, value: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  u.set(key, value);
  return u.toString();
}

// Build the URL string with one parameter dropped. Mirrors the main
// closet's helper so chip "off" taps reset cleanly.
function dropParam(sp: Record<string, string | undefined>, key: string): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || !v) continue;
    u.set(k, v);
  }
  const qs = u.toString();
  return qs ? `/wardrobe/backroom?${qs}` : "/wardrobe/backroom";
}
