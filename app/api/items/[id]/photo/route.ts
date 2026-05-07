import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  saveUpload as save,
  saveBuffer,
  saveUploadWithOriginal as saveWithOrig,
  rotateOnDisk,
  unlinkUpload as unlink,
  computeDHash,
} from "@/lib/uploads";
import { runHiResBgRemovalBatch } from "@/lib/bgRemovalServer";

export const runtime = "nodejs";

// Photo replacements append a random tag so the new URL doesn't collide
// with the browser-cached old one.
const saveUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  save(userId, itemId, file, suffix, { bust: true });
const saveMainUpload = (userId: string, itemId: string, file: File, suffix: string) =>
  saveWithOrig(userId, itemId, file, suffix, { bust: true });

// Pull a 90 / 180 / 270 from a request body, defaulting to 90 if the
// caller fat-fingered something. Anything outside the valid set falls
// back so a bad client can't inject a free-form rotation we'd happily
// run through sharp.
function parseDegrees(value: unknown): 90 | 180 | 270 {
  if (value === 180) return 180;
  if (value === 270) return 270;
  return 90;
}

// Replace / rotate the MAIN photo (and its bg-removed companion) on
// an existing item. Label photos used to live here too, but moved to
// /api/items/[id]/photos with kind="label" so an item can carry many
// labels — see that route for label add / delete / rotate.
//   - `image` (required for `which=main`): new main photo
//   - `imageBgRemoved` (optional, with `which=main`): pre-removed companion
//   - `which=main-rotate { degrees }` server-side rotate
//   - `which=bg`: replace just the bg-removed variant
//   - `which=bg-clear`: drop the bg-removed variant
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const item = await prisma.item.findFirst({ where: { id, ownerId: userId } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const which = String(form.get("which") || "");

  if (which === "main") {
    const image = form.get("image");
    const bg = form.get("imageBgRemoved");
    if (!image || !(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }
    const { displayPath: newImage, originalPath: newOriginal } = await saveMainUpload(
      userId,
      id,
      image,
      "orig",
    );
    let newBg: string | null = null;
    if (bg && bg instanceof File && bg.size > 0) {
      newBg = await saveUpload(userId, id, bg, "bg");
    }
    // Recompute phash since the photo bytes are entirely new — the
    // previous fingerprint described a photo that no longer exists.
    const newPhash = await computeDHash(Buffer.from(await image.arrayBuffer()));
    const oldImage = item.imagePath;
    const oldOriginal = item.imageOriginalPath;
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: {
        imagePath: newImage,
        imageOriginalPath: newOriginal,
        imageBgRemovedPath: newBg,
        phash: newPhash,
      },
    });
    await unlink(oldImage);
    await unlink(oldOriginal);
    await unlink(oldBg);
    // Re-run the hi-res cutout in the background — the previous one
    // was for the photo that no longer exists. Fire-and-forget; the
    // helper unlinks the stale cutout as part of its update.
    void runHiResBgRemovalBatch(prisma, userId, [id]).catch((err) => {
      console.warn("hi-res bg removal kick-off failed (replace):", err);
    });
    return NextResponse.json({ item: updated });
  }

  // Just replace the bg-removed variant — keeps the original photo.
  // Used by the "Re-run background removal" button on item detail.
  if (which === "bg") {
    const bg = form.get("imageBgRemoved");
    if (!bg || !(bg instanceof File) || bg.size === 0) {
      return NextResponse.json({ error: "Missing imageBgRemoved" }, { status: 400 });
    }
    const newBg = await saveUpload(userId, id, bg, "bg");
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: { imageBgRemovedPath: newBg },
    });
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  // Drop the bg-removed variant entirely (revert to original photo).
  if (which === "bg-clear") {
    const oldBg = item.imageBgRemovedPath;
    const updated = await prisma.item.update({
      where: { id },
      data: { imageBgRemovedPath: null },
    });
    await unlink(oldBg);
    return NextResponse.json({ item: updated });
  }

  // Rotate the main hero photo by 90 / 180 / 270° on the server.
  // Reads the existing original (or display variant for legacy items
  // with no original), rotates with sharp, runs the rotated buffer
  // back through the two-tier save so the new display + original both
  // come out the right way up. Bg-removed variant is rotated alongside
  // so the closet card stays in sync.
  if (which === "main-rotate") {
    const degrees = parseDegrees(Number(form.get("degrees")));
    const sourcePath = item.imageOriginalPath ?? item.imagePath;
    const { buf, ext } = await rotateOnDisk(sourcePath, degrees);
    const mime =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const rotatedFile = new File([new Uint8Array(buf)], `rotated.${ext}`, { type: mime });
    const { displayPath: newImage, originalPath: newOriginal } = await saveMainUpload(
      userId,
      id,
      rotatedFile,
      "orig",
    );

    let newBg: string | null = null;
    if (item.imageBgRemovedPath) {
      const { buf: bgBuf, ext: bgExt } = await rotateOnDisk(item.imageBgRemovedPath, degrees);
      const tag = Math.random().toString(36).slice(2, 8);
      newBg = await saveBuffer(userId, id, bgBuf, `bg-${tag}`, bgExt);
    }
    // Hi-res cutout: rotate it physically too if present, so the
    // lightbox stays in sync with the rotated original. We rotate
    // the existing PNG rather than re-running bg removal — same
    // mask, just transformed pixels, preserves the edge fidelity
    // the worker already produced.
    let newHiResBg: string | null = null;
    if (item.imageBgRemovedOriginalPath) {
      const { buf: hbBuf, ext: hbExt } = await rotateOnDisk(
        item.imageBgRemovedOriginalPath,
        degrees,
      );
      const tag = Math.random().toString(36).slice(2, 8);
      newHiResBg = await saveBuffer(userId, id, hbBuf, `bg-hires-${tag}`, hbExt);
    }

    const oldImage = item.imagePath;
    const oldOriginal = item.imageOriginalPath;
    const oldBg = item.imageBgRemovedPath;
    const oldHiResBg = item.imageBgRemovedOriginalPath;
    const updated = await prisma.item.update({
      where: { id },
      data: {
        imagePath: newImage,
        imageOriginalPath: newOriginal,
        imageBgRemovedPath: newBg,
        imageBgRemovedOriginalPath: newHiResBg,
      },
    });
    await unlink(oldImage);
    await unlink(oldOriginal);
    await unlink(oldBg);
    await unlink(oldHiResBg);
    return NextResponse.json({ item: updated });
  }

  return NextResponse.json({ error: "Unknown which" }, { status: 400 });
}
