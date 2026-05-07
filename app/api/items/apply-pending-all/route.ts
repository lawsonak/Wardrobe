import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, listToCsv, type Category } from "@/lib/constants";
import { brandKey } from "@/lib/brand";
import { parse as parsePending } from "@/lib/pendingAi";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// POST /api/items/apply-pending-all
//
// One-shot bulk approve for AI suggestions that were staged onto
// items by a re-tag run. Each affected row has a non-null
// `pendingAiSuggestions` blob waiting for review. This route walks
// every owned item with a pending blob (optionally scoped to a
// specific itemIds list), applies each field to the item, and
// clears the blob.
//
// Mirrors the per-item "Accept all" path on the edit page, just
// across the whole pending queue. Brand suggestions go through the
// canonical `Brand` upsert so "Madewell" and "madewell." don't
// stack as duplicates. Material lands in `fitNotes` only when the
// item didn't already have material info — never overwrites a
// hand-typed note.
//
// Body:
//   { itemIds?: string[] }   // optional scope; defaults to all
//                            // owned items with pending blobs
//
// Response:
//   { applied: number, errors: number }
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
  const itemIds = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  const items = await prisma.item.findMany({
    where: {
      ownerId: userId,
      pendingAiSuggestions: { not: null },
      ...(itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : {}),
    },
  });

  let applied = 0;
  let errors = 0;

  for (const item of items) {
    const pending = parsePending(item.pendingAiSuggestions);
    if (!pending) {
      // Stale / malformed blob — clear it so the row stops showing
      // up as pending forever.
      await prisma.item.update({
        where: { id: item.id },
        data: { pendingAiSuggestions: null },
      });
      continue;
    }

    const data: Record<string, unknown> = { pendingAiSuggestions: null };

    if (pending.category && (CATEGORIES as readonly string[]).includes(pending.category)) {
      data.category = pending.category as Category;
    }
    if (pending.subType) data.subType = pending.subType;
    if (pending.color) data.color = pending.color;
    if (pending.size) data.size = pending.size;
    if (pending.seasons && pending.seasons.length > 0) {
      data.seasons = listToCsv(pending.seasons);
    }
    if (pending.activities && pending.activities.length > 0) {
      data.activities = listToCsv(pending.activities);
    }
    // Material lands in fitNotes only when the field is empty —
    // a hand-typed care note shouldn't get clobbered.
    if (pending.material && !item.fitNotes) {
      data.fitNotes = `Material: ${pending.material}`;
    }

    if (pending.brand) {
      const text = pending.brand.trim();
      const key = brandKey(text);
      if (key) {
        let upserted: Awaited<ReturnType<typeof prisma.brand.upsert>> | null = null;
        try {
          upserted = await prisma.brand.upsert({
            where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
            update: {},
            create: { ownerId: userId, name: text, nameKey: key },
          });
        } catch {
          // Concurrent insert lost the unique-index race — fall
          // back to lookup so this item still ends up linked to
          // the canonical brand row.
          upserted = await prisma.brand.findUnique({
            where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
          });
        }
        if (upserted) {
          data.brand = upserted.name;
          data.brandId = upserted.id;
        }
      }
    }

    try {
      await prisma.item.update({ where: { id: item.id }, data });
      applied++;
    } catch (err) {
      errors++;
      console.warn(
        `apply-pending-all: ${item.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (applied > 0) {
    await logActivity({
      userId,
      kind: "item.bulk-apply-pending",
      summary: `Applied AI suggestions to ${applied} item${applied === 1 ? "" : "s"}`,
      meta: { applied, errors },
    });
  }

  return NextResponse.json({ applied, errors });
}
