import { prisma } from "@/lib/db";

// Strictly per-user activity log surfaced on the Settings page. Each
// row is a thin record of one user-visible action — a write, an AI
// call, or a sign-in. We keep summaries terse so the UI stays readable
// even after months of use; structured details go in `meta` when a
// caller wants them.
//
// Logging is best-effort: helper failures never throw out to the
// caller, since dropping a save just because the audit row failed
// would be worse than the missing log entry.

const RETENTION_DAYS = 90;
// Lazy prune. Each successful write has a 1-in-N chance of also
// firing a deleteMany over rows older than RETENTION_DAYS. Spreads
// the cost across writes instead of needing a cron, and
// (RETENTION_DAYS, PRUNE_PROBABILITY) are tuned so the table never
// drifts more than a couple of percent past the retention window.
const PRUNE_PROBABILITY = 0.01;
const SUMMARY_MAX = 200;

export type ActivityKind =
  // Closet writes
  | "item.create"
  | "item.update"
  | "item.delete"
  | "item.bulk-create"
  | "item.bulk-approve"
  | "item.photo.update"
  // Outfits
  | "outfit.create"
  | "outfit.update"
  | "outfit.delete"
  // Collections
  | "collection.create"
  | "collection.update"
  | "collection.delete"
  // Wishlist
  | "wishlist.create"
  | "wishlist.update"
  | "wishlist.delete"
  | "wishlist.purchased"
  // Mannequin
  | "mannequin.update"
  | "mannequin.reset"
  // AI
  | "ai.tag"
  | "ai.tag-bulk"
  | "ai.outfit"
  | "ai.today"
  | "ai.packing"
  | "ai.search"
  | "ai.shop"
  | "ai.suggestion"
  | "ai.tryon"
  | "ai.bg-remove-batch"
  // Maintenance
  | "photos.optimize"
  // Auth
  | "auth.signin";

export type LogActivityArgs = {
  userId: string;
  kind: ActivityKind;
  summary: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
};

export async function logActivity(args: LogActivityArgs): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        summary: args.summary.slice(0, SUMMARY_MAX),
        targetType: args.targetType ?? null,
        targetId: args.targetId ?? null,
        meta: args.meta ? JSON.stringify(args.meta).slice(0, 1_000) : null,
      },
    });
    if (Math.random() < PRUNE_PROBABILITY) {
      await pruneOldRows(args.userId).catch((err) => {
        console.warn("[activity] prune failed:", err);
      });
    }
  } catch (err) {
    console.warn("[activity] log failed:", err);
  }
}

async function pruneOldRows(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.activityLog.deleteMany({
    where: { userId, createdAt: { lt: cutoff } },
  });
}

/** Format a brief item label for log summaries — "navy T-shirt", "Madewell jeans", or just the category. */
export function describeItem(item: {
  subType?: string | null;
  category?: string | null;
  color?: string | null;
  brand?: string | null;
}): string {
  const parts: string[] = [];
  if (item.color) parts.push(item.color);
  if (item.subType) parts.push(item.subType);
  else if (item.category) parts.push(item.category);
  const base = parts.join(" ").trim() || "an item";
  return item.brand ? `${item.brand} ${base}` : base;
}
