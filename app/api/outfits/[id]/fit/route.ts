import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SLOTS, type Slot } from "@/lib/constants";
import { getMannequinForUser } from "@/lib/mannequin";
import { extractItemFits } from "@/lib/ai/itemFit";

export const runtime = "nodejs";
// Vision pass with 1 mannequin + N item images can hit 30s on a
// flaky model. 90 buys headroom.
export const maxDuration = 90;

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

// POST /api/outfits/[id]/fit
//
// Runs the AI per-item fit pass against the user's mannequin and
// saves the resulting positions into Outfit.layoutJson. Same shape
// the StyleCanvas / OutfitMiniCanvas already render.
//
// Triggered by:
//   - OutfitBuilder after creating a new outfit (auto, fire-and-forget)
//   - The "✨ Auto-fit" button on the Style canvas (explicit re-run)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "AI is disabled." }, { status: 400 });
  }

  const { id } = await params;
  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!outfit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (outfit.items.length === 0) {
    return NextResponse.json({ error: "Outfit has no pieces yet." }, { status: 400 });
  }

  const mannequin = await getMannequinForUser(userId);
  if (!mannequin.url || !mannequin.renderedAbsPath) {
    return NextResponse.json(
      { error: "Generate your mannequin in Settings first." },
      { status: 400 },
    );
  }
  const mannequinFile = await readUpload(`${userId}/mannequin.png`);
  if (!mannequinFile) {
    return NextResponse.json({ error: "Mannequin missing on disk." }, { status: 400 });
  }

  // Sort outfit items by canonical slot order so the AI sees them in
  // a sensible head→toe sequence.
  const sortedOutfitItems = [...outfit.items].sort(
    (a, b) =>
      (SLOTS as readonly Slot[]).indexOf(a.slot as Slot) -
      (SLOTS as readonly Slot[]).indexOf(b.slot as Slot),
  );

  const itemPayloads: Array<{
    buffer: Buffer;
    mime: string;
    category: string;
    subType: string | null;
    itemId: string;
  }> = [];
  for (const oi of sortedOutfitItems) {
    const p = oi.item.imageBgRemovedPath ?? oi.item.imagePath;
    const file = await readUpload(p);
    if (!file) continue;
    itemPayloads.push({
      buffer: file.buf,
      mime: file.mime,
      category: oi.item.category,
      subType: oi.item.subType,
      itemId: oi.item.id,
    });
  }
  if (itemPayloads.length === 0) {
    return NextResponse.json({ error: "No item photos available." }, { status: 400 });
  }

  const result = await extractItemFits({
    mannequin: { buffer: mannequinFile.buf, mime: mannequinFile.mime },
    items: itemPayloads,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Build a layoutJson string in the {layers:[…]} shape OutfitMini-
  // Canvas + StyleCanvas already consume.
  const layers = itemPayloads.map((it, i) => {
    const fit = result.fits[i] ?? { x: 50, y: 50, w: 40, rotation: 0 };
    return {
      id: it.itemId,
      x: fit.x,
      y: fit.y,
      w: fit.w,
      rotation: fit.rotation,
      z: 4 + i * 0.001,
      hidden: false,
    };
  });
  const layoutJson = JSON.stringify({ layers });

  await prisma.outfit.update({
    where: { id },
    data: { layoutJson },
  });

  return NextResponse.json({ ok: true, layoutJson });
}
