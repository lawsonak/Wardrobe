import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";
import { editDistance } from "@/lib/brand";
import { CATEGORIES, csvToList, type Category } from "@/lib/constants";
import MergeBrandsControl from "./MergeBrandsControl";

export const dynamic = "force-dynamic";

type Issue = {
  itemId: string;
  label: string;
  missing: string[];
};

export default async function MetadataQualityPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const [items, brands] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.brand.findMany({ where: { ownerId: userId }, orderBy: { name: "asc" } }),
  ]);

  // Item-level issues
  const issues: Issue[] = [];
  for (const item of items) {
    const missing: string[] = [];
    if (!item.subType) missing.push("type");
    if (!item.brand) missing.push("brand");
    if (!item.size) missing.push("size");
    if (!item.color) missing.push("color");
    if (csvToList(item.seasons).length === 0) missing.push("seasons");
    if (csvToList(item.activities).length === 0) missing.push("activities");
    if (item.labelImagePath && !item.brand) missing.push("brand from label");
    if (missing.length > 0) {
      issues.push({
        itemId: item.id,
        label: item.subType || `${item.category} item`,
        missing,
      });
    }
  }

  // Brand-level issues: near-duplicate names within the user's brand list.
  const brandPairs: Array<{ a: { id: string; name: string }; b: { id: string; name: string }; distance: number }> = [];
  for (let i = 0; i < brands.length; i++) {
    for (let j = i + 1; j < brands.length; j++) {
      const a = brands[i];
      const b = brands[j];
      const d = editDistance(a.nameKey, b.nameKey);
      if (d > 0 && d <= 2) {
        brandPairs.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, distance: d });
      }
    }
  }

  const totalItems = items.length;
  const itemsWithIssues = issues.length;
  const cleanPct = totalItems === 0 ? 100 : Math.round(((totalItems - itemsWithIssues) / totalItems) * 100);

  // Aggregate counts of missing fields
  const missingCounts: Record<string, number> = {};
  for (const i of issues) for (const m of i.missing) missingCounts[m] = (missingCounts[m] ?? 0) + 1;
  const sortedMissing = Object.entries(missingCounts).sort((a, b) => b[1] - a[1]);

  // Possible duplicate items: same category + same color + similar subType
  // (or both empty) + similar brand. Conservative — we want to flag, not
  // auto-merge. We compare each pair once.
  const dupeNorm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  type DupePair = { a: typeof items[number]; b: typeof items[number]; reason: string };
  const dupePairs: DupePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.category !== b.category) continue;
      const colorA = dupeNorm(a.color);
      const colorB = dupeNorm(b.color);
      if (colorA && colorB && colorA !== colorB) continue;
      const brandA = dupeNorm(a.brand);
      const brandB = dupeNorm(b.brand);
      if (brandA && brandB && brandA !== brandB) continue;
      const subA = dupeNorm(a.subType);
      const subB = dupeNorm(b.subType);
      if (subA && subB && editDistance(subA, subB) > 2) continue;
      const reason = [
        a.category,
        a.color || b.color || null,
        a.brand || b.brand || null,
        a.subType || b.subType || null,
      ]
        .filter(Boolean)
        .join(" · ");
      dupePairs.push({ a, b, reason });
      if (dupePairs.length >= 30) break;
    }
    if (dupePairs.length >= 30) break;
  }

  // Closet gaps: which categories are sparse?
  const categoryCounts: Record<Category, number> = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  ) as Record<Category, number>;
  for (const it of items) {
    const c = it.category as Category;
    if (c in categoryCounts) categoryCounts[c]++;
  }
  // Show categories the user has 0 or 1 of, but only if their closet is
  // big enough that "sparse" means something.
  const totalsForGaps = totalItems >= 5 ? totalItems : 0;
  const gaps = totalsForGaps
    ? CATEGORIES.filter((c) => categoryCounts[c] <= 1).map((c) => ({
        category: c,
        count: categoryCounts[c],
      }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Closet quality</h1>
        <p className="text-sm text-stone-500">
          {firstName ? `${firstName}, you're` : "You're"} {cleanPct}% tagged.{" "}
          {itemsWithIssues > 0 ? `${itemsWithIssues} of ${totalItems} item${totalItems === 1 ? "" : "s"} need a little love.` : "Everything looks great."}
        </p>
      </div>

      {totalItems === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-blush-700">No items yet</p>
          <p className="mt-1 text-stone-600">Add a few pieces and we&apos;ll spot anything missing.</p>
          <Link href="/wardrobe/new" className="btn-primary mt-4 inline-flex">+ Add an item</Link>
        </div>
      ) : (
        <>
          <section className="card p-4">
            <h2 className="font-display text-lg text-stone-800">Most common gaps</h2>
            {sortedMissing.length === 0 ? (
              <p className="mt-1 text-sm text-stone-500">No missing fields.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {sortedMissing.map(([field, n]) => (
                  <li key={field} className="flex items-center justify-between">
                    <span className="capitalize text-stone-700">{field}</span>
                    <span className="text-stone-500">{n} item{n === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {brandPairs.length > 0 && (
            <section className="card p-4">
              <h2 className="font-display text-lg text-stone-800">Possible duplicate brands</h2>
              <p className="text-xs text-stone-500">Names that look like the same brand spelled differently. Pick a canonical and we&apos;ll re-tag every item that uses the other.</p>
              <ul className="mt-3 divide-y divide-stone-100">
                {brandPairs.map((p) => (
                  <li key={`${p.a.id}-${p.b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{p.a.name}</span>
                      <span className="text-stone-400"> · </span>
                      <span className="font-medium">{p.b.name}</span>
                      <span className="ml-2 text-xs text-stone-400">distance {p.distance}</span>
                    </span>
                    <MergeBrandsControl a={p.a} b={p.b} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {dupePairs.length > 0 && (
            <section className="card p-4">
              <h2 className="font-display text-lg text-stone-800">Possible duplicate items</h2>
              <p className="text-xs text-stone-500">
                Same category + matching color and brand. Open both to compare and remove the
                one you don&apos;t want.
              </p>
              <ul className="mt-3 divide-y divide-stone-100">
                {dupePairs.slice(0, 10).map((p) => (
                  <li key={`${p.a.id}-${p.b.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-stone-700">{p.reason}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <Link href={`/wardrobe/${p.a.id}`} className="text-blush-600 hover:underline">
                        {p.a.subType || "Item A"}
                      </Link>
                      <span className="text-stone-300">vs.</span>
                      <Link href={`/wardrobe/${p.b.id}`} className="text-blush-600 hover:underline">
                        {p.b.subType || "Item B"}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
              {dupePairs.length > 10 && (
                <p className="mt-2 text-xs text-stone-500">+ {dupePairs.length - 10} more</p>
              )}
            </section>
          )}

          {gaps.length > 0 && (
            <section className="card p-4">
              <h2 className="font-display text-lg text-stone-800">Closet gaps</h2>
              <p className="text-xs text-stone-500">
                Categories you barely have. Worth picking up next, or adding to your wishlist.
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {gaps.map((g) => (
                  <li key={g.category} className="flex items-center justify-between rounded-xl bg-cream-100 px-3 py-2">
                    <span>
                      <span className="font-medium text-stone-800">{g.category}</span>
                      <span className="block text-xs text-stone-500">
                        {g.count === 0 ? "none yet" : "only 1"}
                      </span>
                    </span>
                    <Link href={`/wishlist/new?category=${encodeURIComponent(g.category)}`} className="text-xs text-blush-600 hover:underline">
                      Wish
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="font-display text-lg text-stone-800">Items that need a tag</h2>
              <p className="text-xs text-stone-500">{issues.length} flagged</p>
            </div>
            {issues.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-stone-500">All clear.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {issues.slice(0, 50).map((i) => (
                  <li key={i.itemId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-800">{i.label}</p>
                      <p className="text-xs text-stone-500">missing: {i.missing.join(", ")}</p>
                    </div>
                    <Link href={`/wardrobe/${i.itemId}`} className="btn-secondary text-xs">Edit</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
