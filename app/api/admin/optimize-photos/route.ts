import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  UPLOAD_ROOT,
  DISPLAY_MAX_EDGE_PX,
  getImageDimensions,
  saveUploadWithOriginal,
  saveBuffer,
  unlinkUpload,
} from "@/lib/uploads";
import { runItemPhotoBgRemovalBatch } from "@/lib/bgRemovalServer";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// 50 photos at ~200ms / image (sharp re-encode + write) is ~10s.
// 500 at ~3 in-flight is ~30s. Generous ceiling so big closets finish.
export const maxDuration = 600;

// Settings → "Optimize old photos" cleanup. Three passes:
//
//   1. Two-tier recovery — Item / ItemPhoto rows that shipped before
//      two-tier storage (PR #132) have `imageOriginalPath = null`
//      and a full-resolution display variant. Re-save through
//      saveUploadWithOriginal so display + original line up with
//      the rest of the closet.
//   2. Bg-removed display-tier shrink — Item.imageBgRemovedPath +
//      ItemPhoto.imageBgRemovedPath cutouts saved at full source
//      resolution get shrunk in place to a 1024-px PNG (alpha
//      preserved). The hi-res `imageBgRemovedOriginalPath` is
//      intentionally left alone — that's the lightbox tap-to-zoom
//      variant.
//   3. Label cutout generation — ItemPhoto rows with `kind="label"`
//      and `imageBgRemovedPath=null` get a brand-new cutout
//      generated on the server via runItemPhotoBgRemovalBatch.
//      Catches labels that were uploaded before per-photo bg
//      removal shipped (and therefore never got a cutout) so the
//      AI tag-reading path and the carousel both have a clean
//      label image to work with.
//
// Photos already at ≤ DISPLAY_MAX_EDGE_PX are left alone for (1) +
// (2) — already small enough; re-encoding would just add a
// generation of JPEG loss.
//
// POST { background?: boolean }
//   - background=true (default): queue the work, return immediately,
//     fire a Notification when done. The user can close the tab.
//   - background=false: blocks; returns the per-item summary.

type Candidate =
  | { kind: "item"; id: string; imagePath: string }
  | { kind: "photo"; id: string; imagePath: string }
  // Background-removed display tiers — shrink in place to 1024 px
  // PNG. No two-tier write here (the high-res cutout is a separate
  // column).
  | { kind: "item-bg"; id: string; imagePath: string }
  | { kind: "photo-bg"; id: string; imagePath: string };

type Work = {
  candidates: Candidate[];
  /** ItemPhoto.id values for label rows missing a bg-removed cutout
   *  but with a usable source image on disk. Pass 3 of runOptimize
   *  feeds these to runItemPhotoBgRemovalBatch. */
  labelPhotosNeedingBg: string[];
};

const inflight = new Set<string>();

async function findWork(userId: string): Promise<Work> {
  const candidates = await findCandidates(userId);

  // Label / care-tag photos that lack a bg-removed cutout. The
  // optimize pass treats these as backfill targets for the per-photo
  // bg-removal pipeline that ships with new uploads. Skip rows whose
  // source file is missing on disk so we don't queue broken refs to
  // the model.
  const labelRows = await prisma.itemPhoto.findMany({
    where: {
      item: { ownerId: userId },
      kind: "label",
      imageBgRemovedPath: null,
    },
    select: { id: true, imagePath: true },
  });
  const labelPhotosNeedingBg: string[] = [];
  for (const p of labelRows) {
    const dim = await getImageDimensions(p.imagePath);
    if (dim) labelPhotosNeedingBg.push(p.id);
  }

  return { candidates, labelPhotosNeedingBg };
}

async function findCandidates(userId: string): Promise<Candidate[]> {
  // Walk four pools in parallel:
  //   1. Item rows with a null imageOriginalPath (pre two-tier).
  //   2. ItemPhoto rows in the same shape.
  //   3. Item rows whose imageBgRemovedPath cutout is oversized.
  //   4. ItemPhoto rows in (3)'s shape (label + angle bg-removes).
  // Each bucket is then dimension-checked: photos already at or
  // under DISPLAY_MAX_EDGE_PX skip the re-encode entirely.
  const [items, photos, itemsBg, photosBg] = await Promise.all([
    prisma.item.findMany({
      where: { ownerId: userId, imageOriginalPath: null },
      select: { id: true, imagePath: true },
    }),
    prisma.itemPhoto.findMany({
      where: { item: { ownerId: userId }, imageOriginalPath: null },
      select: { id: true, imagePath: true, itemId: true },
    }),
    prisma.item.findMany({
      where: { ownerId: userId, imageBgRemovedPath: { not: null } },
      select: { id: true, imageBgRemovedPath: true },
    }),
    prisma.itemPhoto.findMany({
      where: { item: { ownerId: userId }, imageBgRemovedPath: { not: null } },
      select: { id: true, imageBgRemovedPath: true },
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
  for (const it of itemsBg) {
    if (!it.imageBgRemovedPath) continue;
    const dim = await getImageDimensions(it.imageBgRemovedPath);
    if (!dim) continue;
    if (Math.max(dim.width, dim.height) > DISPLAY_MAX_EDGE_PX) {
      candidates.push({ kind: "item-bg", id: it.id, imagePath: it.imageBgRemovedPath });
    }
  }
  for (const p of photosBg) {
    if (!p.imageBgRemovedPath) continue;
    const dim = await getImageDimensions(p.imageBgRemovedPath);
    if (!dim) continue;
    if (Math.max(dim.width, dim.height) > DISPLAY_MAX_EDGE_PX) {
      candidates.push({ kind: "photo-bg", id: p.id, imagePath: p.imageBgRemovedPath });
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

  // Background-removed cutouts: re-encode in place at 1024 px PNG
  // (alpha preserved). One-tier — the high-res cutout lives in a
  // separate column we don't touch here.
  if (c.kind === "item-bg" || c.kind === "photo-bg") {
    const shrunk = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE_PX,
        height: DISPLAY_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, effort: 6 })
      .toBuffer();
    // Random tag prevents the new path from colliding with the old
    // (which we're about to unlink). saveBuffer doesn't bust on its
    // own, so we include the tag in the suffix.
    const tag = Math.random().toString(36).slice(2, 8);
    const suffix = `${c.kind === "item-bg" ? "bg" : "angle-bg"}-${tag}`;
    const newPath = await saveBuffer(userId, c.id, shrunk, suffix, "png");
    if (c.kind === "item-bg") {
      await prisma.item.update({
        where: { id: c.id },
        data: { imageBgRemovedPath: newPath },
      });
    } else {
      await prisma.itemPhoto.update({
        where: { id: c.id },
        data: { imageBgRemovedPath: newPath },
      });
    }
    await unlinkUpload(c.imagePath);
    return;
  }

  const ext = path.extname(c.imagePath).toLowerCase().replace(".", "") || "jpg";
  const mime = EXT_TO_MIME[ext] ?? "image/jpeg";
  // The two-tier helper expects a `File`; build one from the buffer.
  const file = new File([new Uint8Array(buf)], `recover.${ext}`, { type: mime });
  const idPrefix = c.id;
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

type RunResult = {
  count: number;
  fixed: number;
  errors: number;
  /** Subset of `fixed` representing label cutouts generated in pass
   *  3 — surfaced separately in the notification body so the user
   *  can tell labels were specifically backfilled. */
  labelsBgGenerated: number;
};

async function runOptimize(
  userId: string,
  work: Work,
): Promise<RunResult> {
  const { candidates, labelPhotosNeedingBg } = work;
  let fixed = 0;
  let errors = 0;
  let labelsBgGenerated = 0;

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

  // Pass 3: backfill bg-removed cutouts on label photos that were
  // uploaded before the per-photo bg-removal pipeline shipped. This
  // pass is *generative* — runs the ONNX model — so it lives after
  // the lightweight resizes so any model-load failure doesn't lose
  // the cheap wins.
  if (labelPhotosNeedingBg.length > 0) {
    const bg = await runItemPhotoBgRemovalBatch(prisma, userId, labelPhotosNeedingBg);
    labelsBgGenerated = bg.succeeded.length;
    fixed += bg.succeeded.length;
    errors += bg.failed.length;
  }

  return {
    count: candidates.length + labelPhotosNeedingBg.length,
    fixed,
    errors,
    labelsBgGenerated,
  };
}

async function runOptimizeAndNotify(
  userId: string,
  work: Work,
): Promise<void> {
  try {
    const result = await runOptimize(userId, work);
    const total = result.count;
    const labelNote =
      result.labelsBgGenerated > 0
        ? ` Generated ${result.labelsBgGenerated} label cutout${result.labelsBgGenerated === 1 ? "" : "s"}.`
        : "";
    const title =
      result.fixed === total
        ? "Photo optimization complete"
        : "Photo optimization finished with issues";
    const body =
      result.fixed === total
        ? `Optimized ${result.fixed} photo${result.fixed === 1 ? "" : "s"} — closet should feel snappier now.${labelNote}`
        : `Optimized ${result.fixed} of ${total}, ${result.errors} couldn't be processed (left as-is).${labelNote}`;
    await prisma.notification
      .create({ data: { ownerId: userId, title, body, href: "/wardrobe" } })
      .catch(() => {});
    await logActivity({
      userId,
      kind: "photos.optimize",
      summary: `Optimized ${result.fixed} of ${total} photo${total === 1 ? "" : "s"}`,
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

  const work = await findWork(userId);
  const totalWork = work.candidates.length + work.labelPhotosNeedingBg.length;
  if (totalWork === 0) {
    return NextResponse.json({ count: 0, fixed: 0, errors: 0, labelsBgGenerated: 0, queued: false });
  }

  if (background) {
    inflight.add(userId);
    runOptimizeAndNotify(userId, work).finally(() => inflight.delete(userId));
    return NextResponse.json({ queued: true, count: totalWork });
  }

  inflight.add(userId);
  try {
    const result = await runOptimize(userId, work);
    await logActivity({
      userId,
      kind: "photos.optimize",
      summary: `Optimized ${result.fixed} of ${result.count} photo${result.count === 1 ? "" : "s"}`,
      meta: { ...result },
    });
    return NextResponse.json({ queued: false, ...result });
  } finally {
    inflight.delete(userId);
  }
}
