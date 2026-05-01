// Shared compose helpers used by /api/outfits/[id]/tryon and
// /api/ai/outfit/today. The per-Outfit-row try-on route keeps its own
// caching and persistence logic; this module just owns the parts they
// have in common: pick the right mannequin, group items by source
// photo (so a single image with multiple pieces becomes one TryOnGarment),
// load garment buffers from disk, then call generateTryOn.
//
// `composeOutfitForItems` is a convenience for callers that don't need
// caching — it returns the PNG buffer ready to write to disk.

import { promises as fs } from "node:fs";
import path from "node:path";
import { slotForItem } from "@/lib/constants";
import { UPLOAD_ROOT } from "@/lib/uploads";
import { readUserMannequinPng } from "@/lib/mannequin";
import {
  generateTryOn,
  type TryOnGarment,
  type TryOnPiece,
  type TryOnResult,
} from "@/lib/ai/tryon";

const GLOBAL_MANNEQUIN_PNG = path.join(process.cwd(), "public", "mannequin", "base.png");
const GLOBAL_MANNEQUIN_META = path.join(process.cwd(), "public", "mannequin", "base.json");

export type ComposeItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
};

export type Mannequin = { buf: Buffer; id: string };

// Prefer the user's personal mannequin; fall back to the canonical
// public/mannequin/base.png. The mannequin's id ends up in any cache
// hashes the caller computes, so swapping personal/global naturally
// invalidates older renders.
export async function loadMannequinFor(userId: string): Promise<Mannequin | null> {
  const personal = await readUserMannequinPng(userId);
  if (personal) return personal;
  try {
    const buf = await fs.readFile(GLOBAL_MANNEQUIN_PNG);
    let mqId = "mq-v1";
    try {
      const meta = JSON.parse(await fs.readFile(GLOBAL_MANNEQUIN_META, "utf8")) as {
        id?: string;
      };
      if (typeof meta.id === "string" && meta.id.trim()) mqId = meta.id;
    } catch {
      /* meta file is optional */
    }
    return { buf, id: mqId };
  } catch {
    return null;
  }
}

export function photoPathFor(it: ComposeItem): string {
  return it.imageBgRemovedPath ?? it.imagePath;
}

function mimeFor(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

// Group items by their source photo so a single image showing multiple
// pieces (e.g., earrings + shoes laid out together, or a swimsuit
// top+bottom set photographed as one) is sent to Gemini once with all
// pieces enumerated — instead of duplicating the image per piece.
export async function groupAndLoadGarments(
  items: ComposeItem[],
): Promise<TryOnGarment[]> {
  const groups = new Map<string, { firstItem: ComposeItem; pieces: TryOnPiece[] }>();
  for (const it of items) {
    const key = photoPathFor(it);
    const piece: TryOnPiece = {
      id: it.id,
      slot: slotForItem(it.category, it.subType),
      category: it.category,
      subType: it.subType,
      color: it.color,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.pieces.push(piece);
    } else {
      groups.set(key, { firstItem: it, pieces: [piece] });
    }
  }

  const garments: TryOnGarment[] = [];
  for (const [relPath, group] of groups) {
    try {
      const buf = await fs.readFile(path.join(UPLOAD_ROOT, relPath));
      garments.push({
        imageBuf: buf,
        imageMime: mimeFor(relPath),
        hasBackground: !group.firstItem.imageBgRemovedPath,
        pieces: group.pieces,
      });
    } catch {
      /* skip garments we can't load */
    }
  }
  return garments;
}

// One-shot helper for callers that don't need explicit cache control:
// loads mannequin, loads garments, calls Gemini, returns the PNG.
export async function composeOutfitForItems(args: {
  userId: string;
  items: ComposeItem[];
}): Promise<
  | { ok: true; pngBuffer: Buffer; mimeType: string; skippedItemIds: string[]; mannequinId: string }
  | { ok: false; error: string; mannequinReady: boolean }
> {
  const mannequin = await loadMannequinFor(args.userId);
  if (!mannequin) {
    return {
      ok: false,
      error:
        "No mannequin available. Upload a photo in Settings → Your mannequin, or run `npm run generate:mannequin` to create the global default.",
      mannequinReady: false,
    };
  }

  const garments = await groupAndLoadGarments(args.items);
  if (garments.length === 0) {
    return { ok: false, error: "Couldn't load any garment images from disk.", mannequinReady: true };
  }

  const result: TryOnResult = await generateTryOn({
    mannequinBuf: mannequin.buf,
    mannequinMime: "image/png",
    garments,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, mannequinReady: true };
  }

  return {
    ok: true,
    pngBuffer: result.pngBuffer,
    mimeType: result.mimeType,
    skippedItemIds: result.skippedItemIds,
    mannequinId: mannequin.id,
  };
}
