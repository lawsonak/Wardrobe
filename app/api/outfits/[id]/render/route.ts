import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  clearOutfitRender,
  getOutfitRender,
  saveOutfitRender,
} from "@/lib/outfitRender";
import { findSourcePath, getMannequinForUser } from "@/lib/mannequin";
import { renderOutfit, type ItemForRender } from "@/lib/ai/outfitRender";

export const runtime = "nodejs";
// Multi-image generation can take 30-60s on the preview models.
export const maxDuration = 90;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

// Reads a file under the user's upload root and returns buffer + a
// mime guess based on extension.
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

// POST /api/outfits/[id]/render → generate an AI-styled photo of this
// outfit on the user's mannequin (or the source photo if no mannequin
// has been generated yet). Caches the result on disk for fast loads.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Image generation requires GEMINI_API_KEY in .env." },
      { status: 400 },
    );
  }

  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!outfit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (outfit.items.length === 0) {
    return NextResponse.json({ error: "Outfit has no pieces yet." }, { status: 400 });
  }

  // Source for the model: prefer the rendered mannequin, fall back to
  // the original source photo, fall back to a thrown error so the user
  // knows to set one up first.
  const mannequin = await getMannequinForUser(userId);
  let modelImage: { buf: Buffer; mime: string } | null = null;
  if (mannequin.url) {
    // mannequin.url is /api/uploads/<userId>/mannequin.png?v=...; we
    // need the underlying disk path.
    modelImage = await readUpload(`${userId}/mannequin.png`);
  }
  if (!modelImage) {
    const src = await findSourcePath(userId);
    if (src) {
      const buf = await fs.readFile(src).catch(() => null);
      const ext = path.extname(src).toLowerCase();
      const mime =
        ext === ".png" ? "image/png" :
        ext === ".webp" ? "image/webp" :
        "image/jpeg";
      if (buf) modelImage = { buf, mime };
    }
  }
  if (!modelImage) {
    return NextResponse.json(
      {
        error:
          "Generate your mannequin in Settings first — we need a model image to dress.",
      },
      { status: 400 },
    );
  }

  // Read each item's image — prefer the bg-removed cutout for cleaner
  // composition, fall back to the original photo.
  const itemPayloads: ItemForRender[] = [];
  for (const oi of outfit.items) {
    const path0 = oi.item.imageBgRemovedPath ?? oi.item.imagePath;
    const file = await readUpload(path0);
    if (!file) continue;
    itemPayloads.push({
      buffer: file.buf,
      mime: file.mime,
      category: oi.item.category,
      subType: oi.item.subType,
      color: oi.item.color,
    });
  }
  if (itemPayloads.length === 0) {
    return NextResponse.json({ error: "No item photos available." }, { status: 400 });
  }

  const result = await renderOutfit({
    mannequin: { buffer: modelImage.buf, mime: modelImage.mime },
    items: itemPayloads,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: result.status ?? 500 },
      { status: 502 },
    );
  }

  await saveOutfitRender(userId, id, result.png);
  const info = await getOutfitRender(userId, id);
  return NextResponse.json({ ok: true, ...info });
}

// DELETE /api/outfits/[id]/render → drop the cached render so the
// outfit reverts to the layered cutout preview.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await clearOutfitRender(userId, id);
  return NextResponse.json({ ok: true });
}
