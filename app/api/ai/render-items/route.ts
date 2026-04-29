import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getMannequinForUser } from "@/lib/mannequin";
import { renderOutfit, type ItemForRender } from "@/lib/ai/outfitRender";

export const runtime = "nodejs";
export const maxDuration = 90;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

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

// POST /api/ai/render-items { itemIds: string[] }
//
// Ad-hoc AI compose of a set of items on the user's mannequin —
// used by the dashboard's "Today's outfit" card. Cached to disk by
// sorted itemIds + mannequin mtime so the same pick reloads free.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "Image generation requires GEMINI_API_KEY in .env." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const itemIds: string[] = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "Missing itemIds" }, { status: 400 });
  }

  const mannequin = await getMannequinForUser(userId);
  if (!mannequin.url || !mannequin.renderedAbsPath) {
    return NextResponse.json(
      { error: "Generate your mannequin in Settings first." },
      { status: 400 },
    );
  }

  let mannequinMtime = 0;
  try {
    const stat = await fs.stat(mannequin.renderedAbsPath);
    mannequinMtime = stat.mtimeMs;
  } catch {
    return NextResponse.json({ error: "Mannequin missing on disk." }, { status: 400 });
  }
  const cacheKey = shortHash(
    `${[...itemIds].sort().join(",")}|${Math.floor(mannequinMtime)}`,
  );
  const dir = path.join(UPLOAD_ROOT, userId);
  const cacheFile = `render-${cacheKey}.png`;
  const cacheAbs = path.join(dir, cacheFile);
  try {
    const cached = await fs.stat(cacheAbs);
    return NextResponse.json({
      ok: true,
      url: `/api/uploads/${userId}/${cacheFile}?v=${cached.mtimeMs.toFixed(0)}`,
      cached: true,
    });
  } catch {
    /* not cached — render fresh */
  }

  const items = await prisma.item.findMany({
    where: { ownerId: userId, id: { in: itemIds } },
    select: {
      id: true, imagePath: true, imageBgRemovedPath: true,
      category: true, subType: true, color: true,
    },
  });
  const itemPayloads: ItemForRender[] = [];
  for (const it of items) {
    const p = it.imageBgRemovedPath ?? it.imagePath;
    const file = await readUpload(p);
    if (!file) continue;
    itemPayloads.push({
      buffer: file.buf,
      mime: file.mime,
      category: it.category,
      subType: it.subType,
      color: it.color,
    });
  }
  if (itemPayloads.length === 0) {
    return NextResponse.json({ error: "No item photos available." }, { status: 400 });
  }

  const mannequinFile = await readUpload(`${userId}/mannequin.png`);
  if (!mannequinFile) {
    return NextResponse.json({ error: "Mannequin missing on disk." }, { status: 400 });
  }

  const result = await renderOutfit({
    mannequin: { buffer: mannequinFile.buf, mime: mannequinFile.mime },
    items: itemPayloads,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheAbs, result.png);
  const stat = await fs.stat(cacheAbs);
  return NextResponse.json({
    ok: true,
    url: `/api/uploads/${userId}/${cacheFile}?v=${stat.mtimeMs.toFixed(0)}`,
    cached: false,
  });
}
