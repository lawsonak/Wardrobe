import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";
import { editDistance } from "@/lib/brand";
import { csvToList } from "@/lib/constants";
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
