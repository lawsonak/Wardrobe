import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// JSON snapshot of everything the current user owns. Photos are referenced
// by their /api/uploads/<path>; the server's data/uploads/ folder is the
// other half of the backup. Document this in the deploy guide.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, items, outfits, wishlist, brands, capsules] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    prisma.item.findMany({ where: { ownerId: userId } }),
    prisma.outfit.findMany({
      where: { ownerId: userId },
      include: { items: { select: { itemId: true, slot: true } } },
    }),
    prisma.wishlistItem.findMany({ where: { ownerId: userId } }),
    prisma.brand.findMany({
      where: { ownerId: userId },
      include: { aliases: true },
    }),
    prisma.capsule.findMany({
      where: { ownerId: userId },
      include: { items: { select: { itemId: true } } },
    }),
  ]);

  const data = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user,
    counts: {
      items: items.length,
      outfits: outfits.length,
      wishlist: wishlist.length,
      brands: brands.length,
      capsules: capsules.length,
    },
    brands,
    items,
    outfits,
    wishlist,
    capsules,
    notes:
      "Photos live on the server at data/uploads/ and are referenced by " +
      "imagePath / imageBgRemovedPath / labelImagePath in items, and " +
      "imagePath in wishlist. Back those up alongside this JSON.",
  };

  const filename = `wardrobe-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
