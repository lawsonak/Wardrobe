import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// POST /api/items/approve-all
//
// One-shot bulk approve for the Needs Review inbox. Body shape:
//   { itemIds?: string[] }
// When `itemIds` is omitted, defaults to every item the caller owns
// in `needs_review` status (the implicit "approve everything in my
// queue" action). Rows are filtered by ownerId server-side so a stray
// id from another account is silently ignored.
//
// Returns { approved: number } — the count of rows actually updated.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
  const itemIds = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  const result = await prisma.item.updateMany({
    where: {
      ownerId: userId,
      status: "needs_review",
      ...(itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : {}),
    },
    data: { status: "active" },
  });

  if (result.count > 0) {
    await logActivity({
      userId,
      kind: "item.bulk-approve",
      summary: `Approved ${result.count} item${result.count === 1 ? "" : "s"} from Needs Review`,
      meta: { count: result.count },
    });
  }

  return NextResponse.json({ approved: result.count });
}
