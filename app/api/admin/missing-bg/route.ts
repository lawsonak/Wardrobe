import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/admin/missing-bg
// Lists active items that don't yet have a background-removed photo
// variant. Used by the "Clean up all photos" admin button so the
// client can walk and remove backgrounds in batch.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.item.findMany({
    where: { ownerId: userId, imageBgRemovedPath: null, status: { not: "draft" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, imagePath: true, category: true, subType: true },
  });

  return NextResponse.json({ items });
}
