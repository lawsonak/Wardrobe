// Backroom filter helpers. The Item.isBackroom flag is the source of
// truth; everything else (closet view, outfit list, collection list,
// AI prompts) just composes one of these into its `where` clause.
//
// Default everywhere is "exclude Backroom items." Each user-visible
// surface gets its own toggle to flip `includeBackroom` on, and a
// few specific endpoints (admin maintenance, full export, ownership
// checks of a known id) skip the filter entirely.

import type { Prisma } from "@prisma/client";

/** Item-level filter. Compose into any `prisma.item.findMany` where
 *  clause that's user-visible / fed to AI. */
export function backroomItemFilter(
  includeBackroom: boolean,
): Pick<Prisma.ItemWhereInput, "isBackroom"> | Record<string, never> {
  return includeBackroom ? {} : { isBackroom: false };
}

/** Outfit-level filter — hides outfits whose item set contains any
 *  Backroom item. Implemented as a `none: { item: { isBackroom: true }}`
 *  predicate on the OutfitItem relation, which compiles to a
 *  NOT EXISTS subquery on SQLite. */
export function backroomOutfitFilter(
  includeBackroom: boolean,
): Pick<Prisma.OutfitWhereInput, "items"> | Record<string, never> {
  if (includeBackroom) return {};
  return {
    items: { none: { item: { isBackroom: true } } },
  };
}

/** Collection-level filter — same shape as outfit but on
 *  CollectionItem. */
export function backroomCollectionFilter(
  includeBackroom: boolean,
): Pick<Prisma.CollectionWhereInput, "items"> | Record<string, never> {
  if (includeBackroom) return {};
  return {
    items: { none: { item: { isBackroom: true } } },
  };
}

/** Read the `?backroom=1` query param the closet / outfits / collections
 *  pages use. Treats anything truthy ("1", "true", "yes") as opt-in;
 *  everything else hides. The dedicated /wardrobe/backroom page sets
 *  this server-side regardless of the URL. */
export function readBackroomParam(value: string | string[] | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
