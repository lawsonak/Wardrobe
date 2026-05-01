import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearUserMannequin,
  getUserMannequin,
  readSourcePhoto,
  saveRendered,
  saveSourcePhoto,
} from "@/lib/mannequin";
import { generateMannequinFromPhoto } from "@/lib/ai/mannequin";
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

// POST handles:
//   - multipart with `source` File: save source + generate illustration
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
    const result = await generateMannequinFromPhoto({ photo: photoBuf, mime: photoMime });
    if (!result.ok) {
      const info = await getUserMannequin(userId);
      return NextResponse.json({ error: result.error, ...info, debug: result.debug }, { status: 502 });
    }

    await saveRendered(userId, result.pngBuffer);
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
