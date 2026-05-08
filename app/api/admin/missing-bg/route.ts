import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/admin/missing-bg
// Lists every photo that doesn't yet have a background-removed cutout
// — both Item hero photos AND ItemPhoto angle / label rows. Used by
// the admin "Clean up all photos" button so the client can walk and
// remove backgrounds in batch.
//
// Returns:
//   { items:  [{ id, imagePath, category, subType }] }     // hero photos
//   { photos: [{ id, itemId, imagePath, kind, label }] }   // angles + labels
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [items, photos] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId, imageBgRemovedPath: null, status: { not: "draft" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, imagePath: true, category: true, subType: true },
    }),
    // ItemPhoto rows are owner-scoped via the parent Item. Drafts get
    // skipped at the Item level above, so we filter out their photos
    // here too — keeps the cleanup list aligned with the user's
    // visible closet.
    prisma.itemPhoto.findMany({
      where: {
        imageBgRemovedPath: null,
        item: { ownerId: userId, status: { not: "draft" } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, itemId: true, imagePath: true, kind: true, label: true },
    }),
  ]);

  return NextResponse.json({ items, photos });
}
