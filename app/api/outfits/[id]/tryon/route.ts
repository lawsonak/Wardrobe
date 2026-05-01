import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORY_TO_SLOT, type Category, type Slot } from "@/lib/constants";
import { saveBuffer, unlinkUpload, UPLOAD_ROOT } from "@/lib/uploads";
import {
  generateTryOn,
  TRY_ON_PROMPT_VERSION,
  type TryOnGarment,
} from "@/lib/ai/tryon";

export const runtime = "nodejs";
// Image generation can take 5-15s; 30s gives margin without dragging on.
export const maxDuration = 60;

const MANNEQUIN_PNG = path.join(process.cwd(), "public", "mannequin", "base.png");
const MANNEQUIN_META = path.join(process.cwd(), "public", "mannequin", "base.json");

// Single-process lock so two parallel calls for the same outfit don't both
// burn a Gemini call. Sufficient for a single-server personal app.
const inflight = new Set<string>();

type ItemRow = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
};

async function readMannequin(): Promise<{ buf: Buffer; id: string } | null> {
  try {
    const buf = await fs.readFile(MANNEQUIN_PNG);
    let mqId = "mq-v1";
    try {
      const meta = JSON.parse(await fs.readFile(MANNEQUIN_META, "utf8")) as { id?: string };
      if (typeof meta.id === "string" && meta.id.trim()) mqId = meta.id;
    } catch {
      /* meta file is optional */
    }
    return { buf, id: mqId };
  } catch {
    return null;
  }
}

function slotFor(category: string): Slot {
  return CATEGORY_TO_SLOT[category as Category] ?? "accessory";
}

async function statMtime(relPath: string): Promise<number | null> {
  try {
    const s = await fs.stat(path.join(UPLOAD_ROOT, relPath));
    return Math.floor(s.mtimeMs);
  } catch {
    return null;
  }
}

async function buildHash(args: {
  mannequinId: string;
  items: ItemRow[];
}): Promise<string> {
  const sorted = [...args.items].sort((a, b) => a.id.localeCompare(b.id));
  const itemKeys = await Promise.all(
    sorted.map(async (it) => {
      const photoPath = it.imageBgRemovedPath ?? it.imagePath;
      const mtime = await statMtime(photoPath);
      return {
        id: it.id,
        slot: slotFor(it.category),
        path: photoPath,
        mtime,
      };
    }),
  );
  const payload = JSON.stringify({
    mq: args.mannequinId,
    promptVersion: TRY_ON_PROMPT_VERSION,
    items: itemKeys,
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

async function loadGarment(it: ItemRow): Promise<TryOnGarment | null> {
  const useBg = !!it.imageBgRemovedPath;
  const relPath = it.imageBgRemovedPath ?? it.imagePath;
  try {
    const buf = await fs.readFile(path.join(UPLOAD_ROOT, relPath));
    const ext = path.extname(relPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    return {
      id: it.id,
      slot: slotFor(it.category),
      category: it.category,
      subType: it.subType,
      color: it.color,
      imageBuf: buf,
      imageMime: mime,
      hasBackground: !useBg,
    };
  } catch {
    return null;
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!outfit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (outfit.items.length === 0) {
    return NextResponse.json({ error: "Add at least one piece before generating a try-on." }, { status: 400 });
  }

  const mannequin = await readMannequin();
  if (!mannequin) {
    return NextResponse.json(
      {
        error:
          "Mannequin base image is missing. Run `npm run generate:mannequin` (or commit one to public/mannequin/base.png) before generating try-ons.",
      },
      { status: 500 },
    );
  }

  const items: ItemRow[] = outfit.items.map((oi) => ({
    id: oi.item.id,
    imagePath: oi.item.imagePath,
    imageBgRemovedPath: oi.item.imageBgRemovedPath,
    category: oi.item.category,
    subType: oi.item.subType,
    color: oi.item.color,
  }));

  const hash = await buildHash({ mannequinId: mannequin.id, items });
  if (outfit.tryOnHash === hash && outfit.tryOnImagePath) {
    return NextResponse.json({
      tryOnImagePath: outfit.tryOnImagePath,
      tryOnGeneratedAt: outfit.tryOnGeneratedAt,
      hash,
      fromCache: true,
      skippedItemIds: [],
    });
  }

  if (inflight.has(id)) {
    return NextResponse.json({ error: "A try-on is already generating for this outfit." }, { status: 409 });
  }
  inflight.add(id);

  try {
    const garments = (await Promise.all(items.map(loadGarment))).filter(
      (g): g is TryOnGarment => g !== null,
    );
    if (garments.length === 0) {
      return NextResponse.json({ error: "Couldn't load any garment images from disk." }, { status: 500 });
    }

    const result = await generateTryOn({
      mannequinBuf: mannequin.buf,
      mannequinMime: "image/png",
      garments,
    });

    if (!result.ok) {
      // Keep the previous successful generation visible — surface the error
      // but don't clear `tryOnImagePath`.
      return NextResponse.json(
        {
          error: result.error,
          skippedItemIds: result.skippedItemIds,
          debug: result.debug,
        },
        { status: 502 },
      );
    }

    const ext = result.mimeType === "image/jpeg" ? "jpg" : "png";
    const newPath = await saveBuffer(userId, id, result.pngBuffer, `tryon-${hash}`, ext);

    const oldPath = outfit.tryOnImagePath;
    const updated = await prisma.outfit.update({
      where: { id },
      data: {
        tryOnImagePath: newPath,
        tryOnHash: hash,
        tryOnGeneratedAt: new Date(),
      },
    });

    if (oldPath && oldPath !== newPath) {
      await unlinkUpload(oldPath);
    }

    return NextResponse.json({
      tryOnImagePath: updated.tryOnImagePath,
      tryOnGeneratedAt: updated.tryOnGeneratedAt,
      hash,
      fromCache: false,
      skippedItemIds: result.skippedItemIds,
    });
  } finally {
    inflight.delete(id);
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Lightweight "is the cached image still fresh?" check used by the UI to
  // show the "regenerate?" pill without firing a real generation.
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: { items: { include: { item: true } } },
  });
  if (!outfit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mannequin = await readMannequin();
  const items: ItemRow[] = outfit.items.map((oi) => ({
    id: oi.item.id,
    imagePath: oi.item.imagePath,
    imageBgRemovedPath: oi.item.imageBgRemovedPath,
    category: oi.item.category,
    subType: oi.item.subType,
    color: oi.item.color,
  }));

  const hash = mannequin ? await buildHash({ mannequinId: mannequin.id, items }) : null;
  return NextResponse.json({
    tryOnImagePath: outfit.tryOnImagePath,
    tryOnGeneratedAt: outfit.tryOnGeneratedAt,
    storedHash: outfit.tryOnHash,
    currentHash: hash,
    isFresh: !!hash && hash === outfit.tryOnHash && !!outfit.tryOnImagePath,
    mannequinReady: !!mannequin,
  });
}
