import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearUserMannequin,
  getUserMannequin,
  readSourcePhoto,
  saveRendered,
  saveSourcePhoto,
} from "@/lib/mannequin";
import {
  composeBodyWithHead,
  generateMannequinFromPhoto,
  generateStylizedHead,
} from "@/lib/ai/mannequin";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
// Three Gemini Flash Image calls run sequentially (body → head → compose),
// each ~5-15s. Bumping the timeout for headroom.
export const maxDuration = 120;

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

// Generate the body, generate the cartoon head, then ask Gemini to
// compose them into a single composite. Save whichever PNG is the best
// available outcome (composite > body) — so a compose failure still
// leaves the user with a usable headless mannequin. saveRendered is
// called exactly once so the mannequin id (and try-on cache) flips
// exactly once per "regenerate".
async function generatePipeline(args: {
  userId: string;
  sourcePhoto: Buffer;
  sourceMime: string;
}): Promise<{ ok: true } | { ok: false; error: string; debug?: unknown }> {
  const body = await generateMannequinFromPhoto({ photo: args.sourcePhoto, mime: args.sourceMime });
  if (!body.ok) return { ok: false, error: body.error, debug: body.debug };

  let finalPng = body.pngBuffer;

  try {
    const head = await generateStylizedHead({
      sourcePhoto: args.sourcePhoto,
      sourceMime: args.sourceMime,
      mannequin: body.pngBuffer,
      mannequinMime: body.mimeType || "image/png",
    });
    if (head.ok) {
      const composed = await composeBodyWithHead({
        body: body.pngBuffer,
        bodyMime: body.mimeType || "image/png",
        head: head.pngBuffer,
        headMime: head.mimeType || "image/png",
      });
      if (composed.ok) {
        finalPng = composed.pngBuffer;
      } else {
        console.warn("body+head compose failed:", composed.error);
      }
    } else {
      console.warn("stylized head generation failed:", head.error);
    }
  } catch (err) {
    console.warn("head/compose pipeline threw:", err);
  }

  await saveRendered(args.userId, finalPng);
  return { ok: true };
}

// POST handles:
//   - multipart with `source` File: save source + run the full pipeline
//   - JSON { mode: "regenerate" }: re-run on the saved source
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    const body = await req.json().catch(() => ({} as { mode?: string }));
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
    const result = await generatePipeline({ userId, sourcePhoto: photoBuf, sourceMime: photoMime });
    if (!result.ok) {
      const info = await getUserMannequin(userId);
      return NextResponse.json({ error: result.error, ...info, debug: result.debug }, { status: 502 });
    }
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
  return NextResponse.json({ url: null, hasSource: false, id: null });
}
