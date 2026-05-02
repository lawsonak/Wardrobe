import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// "Already in your closet?" check for the wishlist form. Pure DB
// query — no AI in the loop. Returns up to 3 active items in the
// caller's closet that match on category + (color OR exact subType
// OR brand). The wishlist form shows a soft warning if any match,
// linking to the matches so the user can decide whether to
// duplicate or skip the wish.
//
// GET /api/wishlist/similar?category=Tops&color=pink&subType=blouse&brand=Madewell
//
// All four filters are optional; with none, the route returns nothing
// (so a wishlist row with no metadata doesn't false-alarm).
export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const category = sp.get("category")?.trim() || null;
  const color = sp.get("color")?.trim().toLowerCase() || null;
  const subType = sp.get("subType")?.trim() || null;
  const brand = sp.get("brand")?.trim() || null;

  // Don't surface duplicates from a totally empty form.
  if (!category && !color && !subType && !brand) {
    return NextResponse.json({ matches: [] });
  }

  // Match heuristic: same category AND (same color OR same subType OR
  // same brand). When category isn't set, fall back to color + (subType
  // OR brand). At least two signals must agree so a generic "pink"
  // wishlist row doesn't bury the user in unrelated pink things.
  const ors: Array<Record<string, unknown>> = [];
  if (color) ors.push({ color });
  if (subType) ors.push({ subType: { contains: subType } });
  if (brand) ors.push({ brand: { contains: brand } });

  if (ors.length === 0) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await prisma.item.findMany({
    where: {
      ownerId: userId,
      status: "active",
      ...(category ? { category } : {}),
      OR: ors,
    },
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      color: true,
      brand: true,
    },
    take: 3,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ matches });
}
