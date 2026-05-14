// Closet sort options. Keep the option list + Prisma orderBy mapping
// in one place so the closet page (server) and the SortSelect (client)
// agree on the keys, and so the Spicy / Beauty pages can adopt the
// same set without drift.

import type { Prisma } from "@prisma/client";

export const SORT_OPTIONS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "category", label: "Category" },
  { key: "color", label: "Color" },
  { key: "brand", label: "Brand" },
  { key: "favorites", label: "Favorites first" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && SORT_OPTIONS.some((o) => o.key === value);
}

// Map a sort key to a Prisma orderBy array. Every option falls back to
// createdAt desc as the tie-breaker so groupings render newest-first
// inside each bucket — that's almost always what the user wants.
export function orderByFor(sort: SortKey): Prisma.ItemOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }];
    case "category":
      return [{ category: "asc" }, { subType: "asc" }, { createdAt: "desc" }];
    case "color":
      return [{ color: "asc" }, { createdAt: "desc" }];
    case "brand":
      return [{ brand: "asc" }, { createdAt: "desc" }];
    case "favorites":
      return [{ isFavorite: "desc" }, { createdAt: "desc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }];
  }
}
