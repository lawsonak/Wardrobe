import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearStylizedHead,
  clearUserMannequin,
  getUserMannequin,
  readSourcePhoto,
  readUserMannequinPng,
  saveRendered,
  saveSourcePhoto,
  saveStylizedHead,
} from "@/lib/mannequin";
import {
  generateMannequinFromPhoto,
  generateStylizedHead,
} from "@/lib/ai/mannequin";
import { whiteToTransparent, cropToSilhouette } from "@/lib/imageBg";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
// Photo → illustration is a single Gemini Flash Image call, ~5-15s.
export const maxDuration = 60;

// In-process lock so two concurrent generation requests for the same
// user don't both burn a Gemini call. Sufficient for a single-server
// personal app.
const inflight = new Set<string>();

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const info = await getUserMannequin(userId);
  return NextResponse.json(info);
}

// Best-effort: redraw the user's head in the mannequin's illustration
// style and save it as a transparent PNG that the try-on UIs overlay
// on top of the AI body. Failure is non-fatal — the mannequin still
// works, the user just doesn't get a face overlay.
async function tryGenerateHead(args: {
  userId: string;
  sourcePhoto: Buffer;
  sourceMime: string;
  mannequin: Buffer;
  mannequinMime: string;
}): Promise<void> {
  try {
    const head = await generateStylizedHead({
      sourcePhoto: args.sourcePhoto,
      sourceMime: args.sourceMime,
      mannequin: args.mannequin,
      mannequinMime: args.mannequinMime,
    });
    if (head.ok) {
      // Gemini's "transparent PNG" is unreliable — frequently returns
      // a solid-white background. Chroma-key any white pixels to
      // alpha=0 before saving so the overlay sits cleanly on the
      // try-on without a visible white square. No-op when the model
      // does honor the alpha channel request.
      // Then tighten the canvas to the silhouette so the bbox in the
      // try-on UI positions the head, not Gemini's incidental margin.
      const cleaned = whiteToTransparent(head.pngBuffer);
      const cropped = cropToSilhouette(cleaned);
      await saveStylizedHead(args.userId, cropped);
    } else {
      console.warn("stylized head generation failed:", head.error);
    }
  } catch (err) {
    console.warn("stylized head threw:", err);
  }
}

// POST handles:
//   - multipart with `source` File: save source + generate illustration
//   - JSON { mode: "regenerate" }: re-run on the saved source
//   - JSON { mode: "regenerate-face" }: only re-run the head extraction
//     (cheap way to retry the face overlay without redoing the body)
//   - JSON { mode: "remove-face" }: drop the head overlay only
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  // JSON-only modes that don't need the lock or the source photo flow.
  if (!contentType.includes("multipart/form-data")) {
    const body = await req.json().catch(() => ({} as { mode?: string }));
    if (body?.mode === "remove-face") {
      await clearStylizedHead(userId);
      const info = await getUserMannequin(userId);
      return NextResponse.json(info);
    }
    if (body?.mode === "regenerate-face") {
      if (inflight.has(userId)) {
        return NextResponse.json(
          { error: "A mannequin generation is already in progress for your account." },
          { status: 409 },
        );
      }
      const source = await readSourcePhoto(userId);
      const mannequin = await readUserMannequinPng(userId);
      if (!source || !mannequin) {
        return NextResponse.json(
          { error: "Need both a source photo and a generated mannequin first." },
          { status: 400 },
        );
      }
      inflight.add(userId);
      try {
        await tryGenerateHead({
          userId,
          sourcePhoto: source.buf,
          sourceMime: source.mime,
          mannequin: mannequin.buf,
          mannequinMime: "image/png",
        });
      } finally {
        inflight.delete(userId);
      }
      const info = await getUserMannequin(userId);
      return NextResponse.json(info);
    }
    if (body?.mode !== "regenerate") {
      return NextResponse.json({ error: "Unknown request mode" }, { status: 400 });
    }
  }

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A mannequin generation is already in progress for your account." },
      { status: 409 },
    );
  }

  let photoBuf: Buffer | null = null;
  let photoMime = "image/jpeg";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const source = form.get("source");
    if (!(source instanceof File) || source.size === 0) {
      return NextResponse.json({ error: "Missing source photo" }, { status: 400 });
    }
    await saveSourcePhoto(userId, source, source.type || "image/jpeg");
    photoBuf = Buffer.from(await source.arrayBuffer());
    photoMime = source.type || "image/jpeg";
  } else {
    const saved = await readSourcePhoto(userId);
    if (!saved) {
      return NextResponse.json(
        { error: "No saved source photo to regenerate from. Upload a new photo first." },
        { status: 400 },
      );
    }
    photoBuf = saved.buf;
    photoMime = saved.mime;
  }

  inflight.add(userId);
  try {
    const result = await generateMannequinFromPhoto({ photo: photoBuf, mime: photoMime });
    if (!result.ok) {
      const info = await getUserMannequin(userId);
      return NextResponse.json({ error: result.error, ...info, debug: result.debug }, { status: 502 });
    }

    await saveRendered(userId, result.pngBuffer);
    // Stylized-head overlay is generated as a follow-up call. Failure
    // is non-fatal — the mannequin works without it.
    await tryGenerateHead({
      userId,
      sourcePhoto: photoBuf,
      sourceMime: photoMime,
      mannequin: result.pngBuffer,
      mannequinMime: result.mimeType || "image/png",
    });
    // Bumping the user's mannequin id invalidates every cached try-on
    // for them — surface this with a single tryOnHash=null sweep so the
    // UI shows "regenerate" pills instead of stale renders.
    await prisma.outfit.updateMany({
      where: { ownerId: userId, tryOnHash: { not: null } },
      data: { tryOnHash: null },
    });
    const info = await getUserMannequin(userId);
    return NextResponse.json(info);
  } finally {
    inflight.delete(userId);
  }
}

export async function DELETE() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearUserMannequin(userId);
  // Cached try-ons were generated against the now-deleted mannequin —
  // mark them stale so they regenerate against the global default.
  await prisma.outfit.updateMany({
    where: { ownerId: userId, tryOnHash: { not: null } },
    data: { tryOnHash: null },
  });
  return NextResponse.json({ url: null, hasSource: false, id: null, headUrl: null, headBBox: null });
}
