import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  redoItemBgRemoval,
  redoItemPhotoBgRemoval,
  type Aggressiveness,
} from "@/lib/bgRemovalServer";

export const runtime = "nodejs";

// POST /api/items/[id]/redo-bg
//
// Re-run background removal at a different aggressiveness level. The
// model itself doesn't have a threshold knob, so we post-process the
// alpha channel — see lib/bgRemovalServer.ts ALPHA_CURVES.
//
// Body:
//   { level: 0..4, photoId?: string }
//
//   - level: 0 (loose, preserve fuzzy edges) → 4 (tight, hard cut),
//     2 = default no-op. Each step nudges the alpha multiplier ±0.15
//     and offset ±20.
//   - photoId: when present, retry the cutout on this ItemPhoto
//     (extra angle / label close-up) instead of the item's main hero
//     photo.
//
// On success returns { imageBgRemovedPath } so the client can swap
// the rendered cutout without a full router.refresh() if it wants.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rawLevel = Number(body?.level);
  if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel > 4) {
    return NextResponse.json(
      { error: "level must be an integer 0..4" },
      { status: 400 },
    );
  }
  const level = rawLevel as Aggressiveness;
  const photoId = typeof body?.photoId === "string" && body.photoId.length > 0 ? body.photoId : null;

  try {
    const newPath = photoId
      ? await redoItemPhotoBgRemoval(prisma, userId, photoId, level)
      : await redoItemBgRemoval(prisma, userId, id, level);
    return NextResponse.json({ imageBgRemovedPath: newPath, level });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't re-run bg removal";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message.slice(0, 240) }, { status });
  }
}
