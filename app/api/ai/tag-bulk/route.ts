import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { brandKey } from "@/lib/brand";
import { CATEGORIES, csvToList, listToCsv, SEASONS, ACTIVITIES, type Category } from "@/lib/constants";
import { mergePending, parse as parsePending, serialize as serializePending, type PendingAiSuggestions } from "@/lib/pendingAi";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// Generous max so a 50-item batch can finish before Next aborts the
// route handler (default ~30s on serverless, no cap on a long-running
// Node server like Proxmox).
export const maxDuration = 600;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

async function readUpload(rel: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const full = path.resolve(path.join(UPLOAD_ROOT, rel));
    if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return null;
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" :
      "image/jpeg";
    return { buf, mime };
  } catch {
    return null;
  }
}

// POST {
//   promoteAtConfidence?: number,
//   limit?: number,
//   itemIds?: string[],   // scope to specific items (must belong to caller)
//   background?: boolean, // when true: kick off processing, return
//                         // immediately, the user can close the tab and
//                         // a notification fires when done.
// }
//
// Walks items the user owns, calls Auto-tag on each one (using the saved
// main + label photos), applies suggestions only to empty fields, and
// promotes the item to "active" status when the model's reported
// confidence is >= promoteAtConfidence (default 0.85).
//
// When `itemIds` is omitted, defaults to the caller's needs_review
// queue (legacy behavior). When provided, scopes strictly to that set.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available()) {
    return NextResponse.json(
      { enabled: false, message: "AI tagging is disabled. Set AI_PROVIDER + the matching key in .env." },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const promoteAtConfidence = typeof body.promoteAtConfidence === "number"
    ? Math.max(0, Math.min(1, body.promoteAtConfidence))
    : 0.85;
  const requestedIds = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : (requestedIds ? 100 : 25);
  const background = body.background === true;

  const items = await prisma.item.findMany({
    where: requestedIds
      ? { ownerId: userId, id: { in: requestedIds } }
      : { ownerId: userId, status: "needs_review" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (items.length === 0) {
    return NextResponse.json({ enabled: true, processed: 0, tagged: 0, promoted: 0, errors: 0 });
  }

  await logActivity({
    userId,
    kind: "ai.tag-bulk",
    summary: `Started AI auto-tag on ${items.length} item${items.length === 1 ? "" : "s"}`,
    meta: { count: items.length, background },
  });

  // Background mode: kick off the work without awaiting it, return
  // immediately. On a long-running Node server (the user's Proxmox
  // container) the handler keeps running after the response flushes.
  if (background) {
    void runBatch(userId, items, promoteAtConfidence, true).catch((err) => {
      console.error("Background tag-bulk failed:", err);
    });
    return NextResponse.json({
      enabled: true,
      queued: true,
      count: items.length,
    });
  }

  // Foreground also fires a notification so the bell records a permanent
  // entry — useful if the user navigates to a different page mid-run.
  const result = await runBatch(userId, items, promoteAtConfidence, true);
  return NextResponse.json({ enabled: true, ...result });
}

type BatchResult = {
  processed: number;
  tagged: number;
  promoted: number;
  /** Items where the AI suggested overwriting an already-set field —
   *  staged on the row's pendingAiSuggestions blob for the user to
   *  review from the item edit page. Surfaces in the closet's
   *  "Pending AI" filter pill. */
  pendingCount: number;
  errors: number;
  errorList: Array<{ itemId: string; reason: string }>;
};

async function runBatch(
  userId: string,
  items: Array<Awaited<ReturnType<typeof prisma.item.findMany>>[number]>,
  promoteAtConfidence: number,
  notify: boolean,
): Promise<BatchResult> {
  const provider = getProvider();

  const brands = await prisma.brand.findMany({
    where: { ownerId: userId },
    select: { name: true },
    take: 200,
  });
  const existingBrands = brands.map((b) => b.name);

  let tagged = 0;
  let promoted = 0;
  let pendingCount = 0;
  let errors = 0;
  const errorList: Array<{ itemId: string; reason: string }> = [];

  // Process up to N items in parallel. Each AI call burns one Gemini
  // round-trip (often two with describeItem); serialised, a 25-item
  // batch is ~25 s of mostly-idle network wait. With CONCURRENCY=3
  // it's ~8 s. Counters and errorList are mutated from inside the
  // workers — JS is single-threaded so the increments / pushes are
  // safe between awaits, no atomics needed.
  const CONCURRENCY = 3;
  let cursor = 0;
  const workers = Array(Math.min(CONCURRENCY, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await processItem(item);
    }
  });
  await Promise.all(workers);

  async function processItem(item: typeof items[number]) {
    const main = await readUpload(item.imagePath);
    if (!main) {
      errors++;
      errorList.push({ itemId: item.id, reason: "Main photo not on disk" });
      return;
    }
    const label = item.labelImagePath ? await readUpload(item.labelImagePath) : null;

    try {
      // Two-pass: describe the item first (free-form prose where the
      // model is more confident), then run the structured tagger with
      // those notes as ground truth. Same approach as the per-item
      // edit-page Auto-tag flow — borderline shots commit to enum
      // values much more reliably this way.
      const imageFile = new File([new Uint8Array(main.buf)], "item", { type: main.mime });
      const labelFile = label
        ? new File([new Uint8Array(label.buf)], "label", { type: label.mime })
        : undefined;

      let notesContext: string | undefined;
      if (typeof provider.describeItem === "function") {
        try {
          const notesRes = await provider.describeItem({
            image: imageFile,
            labelImage: labelFile,
            context: {
              category: item.category || undefined,
              subType: item.subType || undefined,
              color: item.color || undefined,
              brand: item.brand || undefined,
              size: item.size || undefined,
              seasons: csvToList(item.seasons),
              activities: csvToList(item.activities),
              existingNotes: item.notes || undefined,
            },
          });
          if (notesRes.notes && notesRes.notes.trim()) notesContext = notesRes.notes.trim();
        } catch {
          /* notes are best-effort; tag call still runs without them */
        }
      }

      const result = await provider.tagImage({
        image: imageFile,
        labelImage: labelFile,
        existingBrands,
        notesContext,
      });
      const s = result.suggestions ?? {};

      const data: Record<string, unknown> = {};
      const pending: PendingAiSuggestions = {};

      // For each field: if currently empty → apply directly. If
      // currently set AND the AI suggestion differs → stage as
      // pending review (so the user opens the item and approves /
      // rejects per row from the existing edit-page panel). If the
      // AI suggestion matches what's already there → skip silently.
      if (s.category && CATEGORIES.includes(s.category as Category) && s.category !== item.category) {
        // Category was previously the only field that always
        // overwrote silently. Now subject to the same review flow.
        if (item.category) pending.category = s.category as Category;
        else data.category = s.category;
      }
      if (s.subType && s.subType.trim() !== (item.subType ?? "").trim()) {
        if (item.subType) pending.subType = s.subType;
        else data.subType = s.subType;
      }
      if (s.color && s.color !== item.color) {
        if (item.color) pending.color = s.color;
        else data.color = s.color;
      }
      if (s.brand && s.brand.trim() !== (item.brand ?? "").trim()) {
        if (item.brand) {
          pending.brand = s.brand;
        } else {
          const text = s.brand.trim();
          const key = brandKey(text);
          if (key) {
            // Two concurrent workers can both miss an existing brand
            // and both try to insert it. The unique index ensures only
            // one wins; the loser falls back to a lookup so this item
            // still ends up linked to the canonical row instead of
            // erroring out.
            let upserted: Awaited<ReturnType<typeof prisma.brand.upsert>> | null = null;
            try {
              upserted = await prisma.brand.upsert({
                where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
                update: {},
                create: { ownerId: userId, name: text, nameKey: key },
              });
            } catch {
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
      }
      if (s.size && s.size.trim() !== (item.size ?? "").trim()) {
        if (item.size) pending.size = s.size;
        else data.size = s.size;
      }
      if (s.seasons) {
        const valid = s.seasons.filter((x) => SEASONS.includes(x as never)) as string[];
        const cur = csvToList(item.seasons).sort().join(",");
        const sug = [...valid].sort().join(",");
        if (valid.length > 0 && cur !== sug) {
          if (cur.length > 0) pending.seasons = valid;
          else data.seasons = listToCsv(valid);
        }
      }
      if (s.activities) {
        const valid = s.activities.filter((x) => ACTIVITIES.includes(x as never)) as string[];
        const cur = csvToList(item.activities).sort().join(",");
        const sug = [...valid].sort().join(",");
        if (valid.length > 0 && cur !== sug) {
          if (cur.length > 0) pending.activities = valid;
          else data.activities = listToCsv(valid);
        }
      }
      const extras: string[] = [];
      if (s.material) extras.push(`Material: ${s.material}`);
      if (s.careNotes) extras.push(`Care: ${s.careNotes}`);
      if (s.notes) extras.push(s.notes);
      if (extras.length > 0 && !item.notes) data.notes = extras.join("\n");
      if (s.material) {
        if (!item.fitNotes) {
          data.fitNotes = `Material: ${s.material}`;
        } else if (!item.fitNotes.toLowerCase().includes("material:")) {
          // Append-only when fit notes exist but no "Material:" line
          // is present yet — additive, no conflict, no review needed.
          data.fitNotes = `${item.fitNotes.trim()}\nMaterial: ${s.material}`;
        } else {
          // fitNotes already has a "Material:" line — pending review.
          pending.material = s.material;
        }
      }

      // Merge pending into the existing pending blob (last run wins
      // per field). Drop the column entirely when there's nothing to
      // review so the closet's "Pending AI" filter doesn't show the
      // item.
      const existingPending = parsePending(item.pendingAiSuggestions);
      const hasNewPending = Object.keys(pending).length > 0;
      if (hasNewPending) {
        data.pendingAiSuggestions = serializePending(mergePending(existingPending, pending));
      }

      const confidence = typeof s.confidence === "number" ? s.confidence : null;
      const willPromote = confidence !== null && confidence >= promoteAtConfidence;
      if (willPromote) data.status = "active";

      if (Object.keys(data).length > 0) {
        await prisma.item.update({ where: { id: item.id }, data });
        tagged++;
        if (willPromote) promoted++;
        if (hasNewPending) pendingCount++;
      } else if (hasNewPending) {
        // Edge case: only conflicts, nothing applied. Still write the
        // pending blob so the user can review.
        await prisma.item.update({
          where: { id: item.id },
          data: { pendingAiSuggestions: data.pendingAiSuggestions as string | null },
        });
        pendingCount++;
      }
    } catch (err) {
      errors++;
      errorList.push({ itemId: item.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (notify) {
    const parts: string[] = [`Tagged ${tagged} of ${items.length} item${items.length === 1 ? "" : "s"}`];
    if (promoted > 0) parts.push(`promoted ${promoted} to active`);
    if (pendingCount > 0) {
      parts.push(`${pendingCount} item${pendingCount === 1 ? "" : "s"} need${pendingCount === 1 ? "s" : ""} review`);
    }
    if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
    // Pending review takes precedence — that's where the user has
    // pending decisions to make.
    const href = pendingCount > 0
      ? "/wardrobe?pending=1"
      : promoted < items.length
        ? "/wardrobe/needs-review"
        : "/wardrobe";
    await prisma.notification
      .create({
        data: {
          ownerId: userId,
          title: `AI tagging complete`,
          body: `${parts.join(", ")}.`,
          href,
        },
      })
      .catch(() => {});
  }

  return { processed: items.length, tagged, promoted, pendingCount, errors, errorList };
}
