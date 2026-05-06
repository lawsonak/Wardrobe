import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  UPLOAD_ROOT,
  DISPLAY_MAX_EDGE_PX,
  getImageDimensions,
  saveUploadWithOriginal,
  unlinkUpload,
} from "@/lib/uploads";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// 50 photos at ~200ms / image (sharp re-encode + write) is ~10s.
// 500 at ~3 in-flight is ~30s. Generous ceiling so big closets finish.
export const maxDuration = 600;

// Settings → "Optimize old photos" cleanup. Targets the photos that
// shipped before two-tier storage (PR #132): main hero + extra angle
// photos that still live as full-resolution uploads at `imagePath`,
// with a null `imageOriginalPath`. Every match gets re-saved through
// the regular two-tier pipeline so display + original both line up
// with the rest of the closet — fast grids on the 1024-px display,
// real detail on tap-to-zoom.
//
// Photos already at ≤ DISPLAY_MAX_EDGE_PX are left alone (they're
// already small enough; there's nothing to recover and re-encoding
// would just add a generation of JPEG loss).
//
// POST { background?: boolean }
//   - background=true (default): queue the work, return immediately,
//     fire a Notification when done. The user can close the tab.
//   - background=false: blocks; returns the per-item summary.

type Candidate = { kind: "item" | "photo"; id: string; imagePath: string };

const inflight = new Set<string>();

async function findCandidates(userId: string): Promise<Candidate[]> {
  // Only walk photos with a null original — those are the ones from
  // before two-tier shipped, plus any we somehow missed. Items
  // already in the new shape (`imageOriginalPath` set) are healthy
  // and don't need touching.
  const [items, photos] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId, imageOriginalPath: null },
      select: { id: true, imagePath: true },
    }),
    prisma.itemPhoto.findMany({
      where: { item: { ownerId: userId }, imageOriginalPath: null },
      select: { id: true, imagePath: true, itemId: true },
    }),
  ]);

  const candidates: Candidate[] = [];
  for (const it of items) {
    const dim = await getImageDimensions(it.imagePath);
    if (!dim) continue; // missing on disk — skip silently
    if (Math.max(dim.width, dim.height) > DISPLAY_MAX_EDGE_PX) {
      candidates.push({ kind: "item", id: it.id, imagePath: it.imagePath });
    }
  }
  for (const p of photos) {
    const dim = await getImageDimensions(p.imagePath);
    if (!dim) continue;
    if (Math.max(dim.width, dim.height) > DISPLAY_MAX_EDGE_PX) {
      candidates.push({ kind: "photo", id: p.id, imagePath: p.imagePath });
    }
  }
  return candidates;
}

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

async function recoverOne(
  userId: string,
  c: Candidate,
): Promise<void> {
  const abs = path.join(UPLOAD_ROOT, c.imagePath);
  const buf = await fs.readFile(abs);
  const ext = path.extname(c.imagePath).toLowerCase().replace(".", "") || "jpg";
  const mime = EXT_TO_MIME[ext] ?? "image/jpeg";
  // The two-tier helper expects a `File`; build one from the buffer.
  const file = new File([new Uint8Array(buf)], `recover.${ext}`, { type: mime });
  const idPrefix = c.kind === "item" ? c.id : c.id;
  const suffix = c.kind === "item" ? "orig" : "angle-orig";
  const { displayPath, originalPath } = await saveUploadWithOriginal(
    userId,
    idPrefix,
    file,
    suffix,
    { bust: true },
  );

  if (c.kind === "item") {
    await prisma.item.update({
      where: { id: c.id },
      data: { imagePath: displayPath, imageOriginalPath: originalPath },
    });
  } else {
    await prisma.itemPhoto.update({
      where: { id: c.id },
      data: { imagePath: displayPath, imageOriginalPath: originalPath },
    });
  }
  // The pre-recovery file is now superseded — saveUploadWithOriginal
  // wrote new bust-tagged filenames, so the old path is orphaned.
  // Unlink it so we don't leave the full-size file behind.
  await unlinkUpload(c.imagePath);
}

type RunResult = { count: number; fixed: number; errors: number };

async function runOptimize(
  userId: string,
  candidates: Candidate[],
): Promise<RunResult> {
  let fixed = 0;
  let errors = 0;

  // Sharp is CPU-heavy; 3 in-flight matches the bg-remove-batch
  // pattern and keeps the LXC responsive while the bulk job runs.
  const CONCURRENCY = 3;
  let cursor = 0;
  const workers = Array(Math.min(CONCURRENCY, candidates.length))
    .fill(0)
    .map(async () => {
      while (cursor < candidates.length) {
        const c = candidates[cursor++];
        try {
          await recoverOne(userId, c);
          fixed++;
        } catch (err) {
          errors++;
          console.warn(
            `optimize-photos: ${c.kind}/${c.id} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    });
  await Promise.all(workers);

  return { count: candidates.length, fixed, errors };
}

async function runOptimizeAndNotify(
  userId: string,
  candidates: Candidate[],
): Promise<void> {
  try {
    const result = await runOptimize(userId, candidates);
    const total = candidates.length;
    const title =
      result.fixed === total
        ? "Photo optimization complete"
        : "Photo optimization finished with issues";
    const body =
      result.fixed === total
        ? `Optimized ${result.fixed} photo${result.fixed === 1 ? "" : "s"} — closet should feel snappier now.`
        : `Optimized ${result.fixed} of ${total}, ${result.errors} couldn't be processed (left as-is).`;
    await prisma.notification
      .create({ data: { ownerId: userId, title, body, href: "/wardrobe" } })
      .catch(() => {});
    await logActivity({
      userId,
      kind: "photos.optimize",
      summary: `Optimized ${result.fixed} of ${total} oversized photo${total === 1 ? "" : "s"}`,
      meta: { ...result },
    });
  } catch (err) {
    console.error("optimize-photos: background run failed:", err);
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { background?: unknown };
  const background = body.background === true;

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "Photo optimization is already running for your account." },
      { status: 409 },
    );
  }

  const candidates = await findCandidates(userId);
  if (candidates.length === 0) {
    return NextResponse.json({ count: 0, fixed: 0, errors: 0, queued: false });
  }

  if (background) {
    inflight.add(userId);
    runOptimizeAndNotify(userId, candidates).finally(() => inflight.delete(userId));
    return NextResponse.json({ queued: true, count: candidates.length });
  }

  inflight.add(userId);
  try {
    const result = await runOptimize(userId, candidates);
    await logActivity({
      userId,
      kind: "photos.optimize",
      summary: `Optimized ${result.fixed} of ${result.count} oversized photo${result.count === 1 ? "" : "s"}`,
      meta: { ...result },
    });
    return NextResponse.json({ queued: false, ...result });
  } finally {
    inflight.delete(userId);
  }
}
