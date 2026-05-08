import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// DELETE /api/activity — wipe the caller's activity log. Strictly
// per-user: the where clause filters by the session userId so the
// other profile's history is never touched. Records one final
// "activity.cleared" entry afterwards so the user can tell the
// action took effect (and so the row isn't completely empty if they
// glance at it again later).
export async function DELETE() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.activityLog.deleteMany({ where: { userId } });

  await logActivity({
    userId,
    kind: "activity.cleared",
    summary: `Cleared activity history (${result.count} entr${result.count === 1 ? "y" : "ies"})`,
    meta: { cleared: result.count },
  });

  return NextResponse.json({ cleared: result.count });
}
