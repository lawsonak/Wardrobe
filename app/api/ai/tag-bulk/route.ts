import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { brandKey } from "@/lib/brand";
import { CATEGORIES, listToCsv, SEASONS, ACTIVITIES, type Category } from "@/lib/constants";

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
  let errors = 0;
  const errorList: Array<{ itemId: string; reason: string }> = [];

  for (const item of items) {
    const main = await readUpload(item.imagePath);
    if (!main) {
      errors++;
      errorList.push({ itemId: item.id, reason: "Main photo not on disk" });
      continue;
    }
    const label = item.labelImagePath ? await readUpload(item.labelImagePath) : null;

    try {
      const result = await provider.tagImage({
        image: new File([new Uint8Array(main.buf)], "item", { type: main.mime }),
        labelImage: label
          ? new File([new Uint8Array(label.buf)], "label", { type: label.mime })
          : undefined,
        existingBrands,
      });
      const s = result.suggestions ?? {};

      const data: Record<string, unknown> = {};
      if (s.category && CATEGORIES.includes(s.category as Category) && s.category !== item.category) {
        data.category = s.category;
      }
      if (s.subType && !item.subType) data.subType = s.subType;
      if (s.color && !item.color) data.color = s.color;
      if (s.brand && !item.brand) {
        const text = s.brand.trim();
        const key = brandKey(text);
        if (key) {
          const upserted = await prisma.brand.upsert({
            where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
            update: {},
            create: { ownerId: userId, name: text, nameKey: key },
          });
          data.brand = upserted.name;
          data.brandId = upserted.id;
        }
      }
      if (s.size && !item.size) data.size = s.size;
      if (s.seasons && (!item.seasons || item.seasons.length === 0)) {
        const valid = s.seasons.filter((x) => SEASONS.includes(x as never));
        if (valid.length > 0) data.seasons = listToCsv(valid as string[]);
      }
      if (s.activities && (!item.activities || item.activities.length === 0)) {
        const valid = s.activities.filter((x) => ACTIVITIES.includes(x as never));
        if (valid.length > 0) data.activities = listToCsv(valid as string[]);
      }
      const extras: string[] = [];
      if (s.material) extras.push(`Material: ${s.material}`);
      if (s.careNotes) extras.push(`Care: ${s.careNotes}`);
      if (s.notes) extras.push(s.notes);
      if (extras.length > 0 && !item.notes) data.notes = extras.join("\n");
      if (s.material && !item.fitNotes) data.fitNotes = `Material: ${s.material}`;

      const confidence = typeof s.confidence === "number" ? s.confidence : null;
      const willPromote = confidence !== null && confidence >= promoteAtConfidence;
      if (willPromote) data.status = "active";

      if (Object.keys(data).length > 0) {
        await prisma.item.update({ where: { id: item.id }, data });
        tagged++;
        if (willPromote) promoted++;
      }
    } catch (err) {
      errors++;
      errorList.push({ itemId: item.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (notify) {
    await prisma.notification
      .create({
        data: {
          ownerId: userId,
          title: `AI tagging complete`,
          body: `Tagged ${tagged} of ${items.length} item${items.length === 1 ? "" : "s"}${promoted > 0 ? `, promoted ${promoted} to active` : ""}${errors > 0 ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}.`,
          href: promoted < items.length ? "/wardrobe/needs-review" : "/wardrobe",
        },
      })
      .catch(() => {});
  }

  return { processed: items.length, tagged, promoted, errors, errorList };
}
