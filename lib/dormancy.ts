import { prisma } from "@/lib/db";
import { lastWearISO, daysSince } from "@/lib/wear";

// How long an item must be untouched before we consider it dormant.
const DORMANT_DAYS = 90;
// Don't nag more than once a week per user.
const NUDGE_COOLDOWN_DAYS = 7;
const NUDGE_TITLE = "A piece you haven't worn lately";

// Server-only helper: looks for items the user owns with no recent wear
// stamp and, at most once a week, drops a single notification linking to
// the oldest of them. Idempotent — safe to call on every dashboard load.
export async function maybeNudgeDormant(userId: string): Promise<void> {
  // Bail early if we already nudged within the cooldown window.
  const recent = await prisma.notification.findFirst({
    where: { ownerId: userId, title: NUDGE_TITLE },
    orderBy: { createdAt: "desc" },
  });
  if (recent && daysSince(recent.createdAt.toISOString().slice(0, 10)) < NUDGE_COOLDOWN_DAYS) {
    return;
  }

  // Pull a sample of active, favorited-or-not items. Order by oldest
  // updatedAt so we naturally surface the most-forgotten first.
  const candidates = await prisma.item.findMany({
    where: { ownerId: userId, status: "active" },
    orderBy: { updatedAt: "asc" },
    take: 60,
  });

  // Score by days-since-wear (or, lacking a wear stamp, days-since-update).
  let target: { id: string; label: string; days: number } | null = null;
  for (const item of candidates) {
    const lastWore = lastWearISO(item.notes);
    let days: number;
    if (lastWore) {
      days = daysSince(lastWore);
    } else {
      const isoDate = item.updatedAt.toISOString().slice(0, 10);
      days = daysSince(isoDate);
    }
    if (days < DORMANT_DAYS) continue;
    if (!target || days > target.days) {
      target = {
        id: item.id,
        label: item.subType ?? item.category,
        days,
      };
    }
  }

  if (!target) return;

  await prisma.notification.create({
    data: {
      ownerId: userId,
      title: NUDGE_TITLE,
      body: `It's been ~${target.days} days since you wore your ${target.label}. Worth a rediscover?`,
      href: `/wardrobe/${target.id}`,
    },
  });
}
