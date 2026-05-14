// Beauty filter helpers. Mirrors lib/backroom.ts shape exactly so
// every user-visible / AI-fed item read can compose one of these
// into its `where` clause. The Item.isBeauty flag is the source of
// truth; everything else (closet view, outfit list, AI prompts,
// pickers, dashboard) just defaults to hide-beauty.

import type { Prisma } from "@prisma/client";

/** Item-level filter. Compose into any `prisma.item.findMany` where
 *  clause that's user-visible OR fed to AI. Default everywhere is
 *  "exclude beauty items" — the dedicated /wardrobe/beauty page is
 *  the one place that flips includeBeauty=true. */
export function beautyItemFilter(
  includeBeauty: boolean,
): Pick<Prisma.ItemWhereInput, "isBeauty"> | Record<string, never> {
  return includeBeauty ? {} : { isBeauty: false };
}

/** Read the `?beauty=1` query param the few surfaces that allow
 *  opt-in expose. Treats anything truthy as opt-in; everything else
 *  hides. The dedicated /wardrobe/beauty page sets this server-side
 *  regardless of URL. */
export function readBeautyParam(value: string | string[] | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
