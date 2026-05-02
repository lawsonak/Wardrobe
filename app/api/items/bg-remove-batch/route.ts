import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runBgRemovalBatch } from "@/lib/bgRemovalServer";

export const runtime = "nodejs";
// A 50-photo batch at ~6-10s/photo with 3-way concurrency runs ~2-3
// minutes. Generous ceiling so big imports finish before Next aborts.
export const maxDuration = 900;

// Server-side bg removal queue. Bulk upload POSTs the itemIds it just
// uploaded; this route processes them with concurrency 3 in the
// background and fires a Notification when done so the user can close
// the tab.
//
// Single-photo edits (ItemPhotoEditor, ItemAngles, AddItemForm) keep
// using the browser-side path in lib/bgRemoval.ts — the user is
// already on the page for those, no need to push them to the server.
//
// POST { itemIds: string[], background?: boolean }
//   - background=true (default): returns immediately, processes in
//     the background, drops a notification.
//   - background=false: blocks until done; returns counts.
const inflight = new Set<string>();

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    itemIds?: unknown;
    background?: unknown;
  };
  const itemIds = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const background = body.background === true;

  if (itemIds.length === 0) {
    return NextResponse.json({ error: "No itemIds provided" }, { status: 400 });
  }

  // Per-user lock so a double-fire from the wizard doesn't kick two
  // batches in parallel and double-process the same items.
  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A bg-removal batch is already running for your account." },
      { status: 409 },
    );
  }

  if (background) {
    // Kick off processing without awaiting. The Node process keeps
    // running after the response flushes, so the user can close the
    // tab the moment uploads finish.
    inflight.add(userId);
    runBatchAndNotify(userId, itemIds).finally(() => inflight.delete(userId));
    return NextResponse.json(
      { queued: true, count: itemIds.length },
      { status: 200 },
    );
  }

  inflight.add(userId);
  try {
    const result = await runBgRemovalBatch(prisma, userId, itemIds);
    return NextResponse.json({
      processed: itemIds.length,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      errors: result.failed,
    });
  } finally {
    inflight.delete(userId);
  }
}

async function runBatchAndNotify(userId: string, itemIds: string[]): Promise<void> {
  try {
    const result = await runBgRemovalBatch(prisma, userId, itemIds);
    const total = itemIds.length;
    const ok = result.succeeded.length;
    const errors = result.failed.length;
    // When every item failed, swap the title to "failed" and bubble the
    // first error up so the user has a real diagnostic in the bell drop-
    // down rather than a generic "0 of 5 succeeded".
    const allFailed = ok === 0 && errors > 0;
    const firstError = result.failed[0]?.error;
    const title = allFailed ? "Background removal failed" : "Background removal complete";
    const body = allFailed
      ? `Couldn't cut out any of ${total} item${total === 1 ? "" : "s"}. First error: ${firstError ?? "unknown"}`
      : `Cut out backgrounds for ${ok} of ${total} item${total === 1 ? "" : "s"}${errors > 0 ? `, ${errors} failed` : ""}.`;
    await prisma.notification
      .create({
        data: { ownerId: userId, title, body, href: "/wardrobe" },
      })
      .catch(() => {});
  } catch (err) {
    console.warn("bg removal background batch failed:", err);
    await prisma.notification
      .create({
        data: {
          ownerId: userId,
          title: "Background removal failed",
          body: err instanceof Error ? err.message.slice(0, 200) : "Unknown error",
          href: "/wardrobe",
        },
      })
      .catch(() => {});
  }
}
