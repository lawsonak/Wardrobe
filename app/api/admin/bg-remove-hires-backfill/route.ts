import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runHiResBgRemovalBatch } from "@/lib/bgRemovalServer";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// Hi-res bg removal at full resolution is the slow path — ~5-15 s
// per photo at concurrency 3. A 200-item closet finishes in ~10-15
// min, so the route handler keeps generous headroom for foreground
// mode. Background mode returns immediately.
export const maxDuration = 900;

// Settings → "Generate hi-res cutouts" maintenance route. Walks
// every owned Item where imageBgRemovedOriginalPath is null and
// either imageOriginalPath or imagePath is set, then runs them
// through the medium-model bg-removal worker. The lightbox tap-to-
// zoom prefers this cutout once present, so backfilling lets old
// items catch up to the new shape without re-uploading anything.
//
// POST { background?: boolean }
//   - background=true (default): kick off, return immediately, fire
//     a Notification when done.
//   - background=false: blocks; returns counts.

const inflight = new Set<string>();

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { background?: unknown };
  const background = body.background === true;

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A hi-res cutout backfill is already running for your account." },
      { status: 409 },
    );
  }

  const targets = await prisma.item.findMany({
    where: { ownerId: userId, imageBgRemovedOriginalPath: null },
    select: { id: true },
  });
  if (targets.length === 0) {
    return NextResponse.json({ count: 0, fixed: 0, errors: 0, queued: false });
  }

  const itemIds = targets.map((t) => t.id);

  if (background) {
    inflight.add(userId);
    runAndNotify(userId, itemIds).finally(() => inflight.delete(userId));
    return NextResponse.json({ queued: true, count: itemIds.length });
  }

  inflight.add(userId);
  try {
    const result = await runHiResBgRemovalBatch(prisma, userId, itemIds);
    await logActivity({
      userId,
      kind: "ai.bg-remove-batch",
      summary: `Backfilled hi-res cutouts for ${result.succeeded.length} of ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`,
      meta: {
        count: itemIds.length,
        fixed: result.succeeded.length,
        errors: result.failed.length,
        kind: "hires-backfill",
      },
    });
    return NextResponse.json({
      queued: false,
      count: itemIds.length,
      fixed: result.succeeded.length,
      errors: result.failed.length,
    });
  } finally {
    inflight.delete(userId);
  }
}

async function runAndNotify(userId: string, itemIds: string[]): Promise<void> {
  try {
    const result = await runHiResBgRemovalBatch(prisma, userId, itemIds);
    const total = itemIds.length;
    const ok = result.succeeded.length;
    const errors = result.failed.length;
    const allFailed = ok === 0 && errors > 0;
    const firstError = result.failed[0]?.error;
    const title = allFailed ? "Hi-res cutout backfill failed" : "Hi-res cutout backfill complete";
    const body = allFailed
      ? `Couldn't process any of ${total} item${total === 1 ? "" : "s"}. First error: ${firstError ?? "unknown"}`
      : `Generated cutouts for ${ok} of ${total} item${total === 1 ? "" : "s"}${errors > 0 ? `, ${errors} failed` : ""}.`;
    await prisma.notification
      .create({ data: { ownerId: userId, title, body, href: "/wardrobe" } })
      .catch(() => {});
    await logActivity({
      userId,
      kind: "ai.bg-remove-batch",
      summary: `Backfilled hi-res cutouts for ${ok} of ${total} item${total === 1 ? "" : "s"}`,
      meta: { count: total, fixed: ok, errors, kind: "hires-backfill" },
    });
  } catch (err) {
    console.error("hi-res cutout backfill failed:", err);
  }
}
