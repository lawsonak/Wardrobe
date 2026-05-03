// Shared "what does this user's closet look like?" snapshot used by AI
// features that need to reason over the user's existing pieces (today's
// product suggestion, collection shop search, etc). Centralizing the
// builder + the prose `describeSummary` keeps the prompt language
// consistent across features so the model gets the same picture of
// the closet wherever we call it.

import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/constants";
import { getPrefs } from "@/lib/userPrefs";

export type ClosetSummary = {
  totalItems: number;
  topBrands: Array<{ name: string; count: number }>;
  topColors: Array<{ name: string; count: number }>;
  categoryCounts: Record<string, number>;
  favoriteCount: number;
  /** Free-form style notes the user has written in Settings. */
  stylePreferences: string | null;
  /** A short list of subTypes the user already has, so the model
   *  doesn't suggest something obviously redundant. */
  ownedSubTypes: string[];
};

export async function buildClosetSummary(userId: string): Promise<ClosetSummary> {
  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    select: {
      brand: true,
      color: true,
      category: true,
      subType: true,
      isFavorite: true,
    },
  });

  const brandTally = new Map<string, number>();
  const colorTally = new Map<string, number>();
  const categoryCounts: Record<string, number> = {};
  for (const c of CATEGORIES) categoryCounts[c] = 0;
  const subTypeSet = new Set<string>();
  let favoriteCount = 0;

  for (const it of items) {
    if (it.brand && it.brand.trim()) {
      const k = it.brand.trim();
      brandTally.set(k, (brandTally.get(k) ?? 0) + 1);
    }
    if (it.color && it.color.trim()) {
      const k = it.color.trim();
      colorTally.set(k, (colorTally.get(k) ?? 0) + 1);
    }
    if (it.category && (CATEGORIES as readonly string[]).includes(it.category)) {
      categoryCounts[it.category as Category]! += 1;
    }
    if (it.subType && it.subType.trim()) {
      subTypeSet.add(it.subType.trim());
    }
    if (it.isFavorite) favoriteCount++;
  }

  const sortByCount = <T,>(m: Map<T, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name: String(name), count }));

  const prefs = await getPrefs();

  return {
    totalItems: items.length,
    topBrands: sortByCount(brandTally).slice(0, 5),
    topColors: sortByCount(colorTally).slice(0, 5),
    categoryCounts,
    favoriteCount,
    stylePreferences: prefs.stylePreferences,
    ownedSubTypes: Array.from(subTypeSet),
  };
}

export function describeSummary(s: ClosetSummary): string {
  const lines: string[] = [];
  lines.push(`Total items: ${s.totalItems}.`);
  if (s.topBrands.length > 0) {
    lines.push(
      `Top brands: ${s.topBrands.map((b) => `${b.name} (${b.count})`).join(", ")}.`,
    );
  }
  if (s.topColors.length > 0) {
    lines.push(
      `Top colors: ${s.topColors.map((c) => `${c.name} (${c.count})`).join(", ")}.`,
    );
  }
  const cats = Object.entries(s.categoryCounts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, n]) => `${cat} ${n}`)
    .join(", ");
  if (cats) lines.push(`Categories: ${cats}.`);
  lines.push(`Favorites: ${s.favoriteCount}.`);
  if (s.ownedSubTypes.length > 0) {
    lines.push(
      `Already owns variations of: ${s.ownedSubTypes.slice(0, 30).join(", ")}.`,
    );
  }
  if (s.stylePreferences && s.stylePreferences.trim()) {
    lines.push(`Style notes from owner: ${s.stylePreferences.trim().slice(0, 500)}`);
  }
  return lines.join(" ");
}
