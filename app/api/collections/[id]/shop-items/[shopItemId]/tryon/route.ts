import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { slotForItem, type Slot } from "@/lib/constants";
import { saveBuffer, unlinkUpload, UPLOAD_ROOT } from "@/lib/uploads";
import { generateTryOn, TRY_ON_PROMPT_VERSION, type TryOnGarment } from "@/lib/ai/tryon";
import { loadMannequinFor } from "@/lib/ai/composeTryOn";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

// Single-process inflight set so a double-tap from the user doesn't
// fire two Gemini calls for the same shop item. Sufficient for a
// single-server personal app — the per-Outfit try-on route uses the
// identical pattern.
const inflight = new Set<string>();

// Sniff the photo's mime type from its extension so the inlineData
// blob we send Gemini matches. Defaults to JPEG since
// `/shop-items/[id]/photo` always saves JPEG; downloaded retailer
// images can be png/webp.
function mimeFor(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// Per-shop-item AI try-on. Composes just THIS one product onto the
// user's mannequin via the same Gemini 2.5 Flash Image pipeline the
// per-Outfit try-on uses, with one garment as input instead of N.
// Sidesteps the 5-garment cap entirely.
//
// The route caches by hash (mannequin id + shop item id + image
// mtime + prompt version) so re-clicks short-circuit. ?force=1
// bypasses the cache for an explicit "regenerate" click — same
// pattern as the outfit route.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shopItemId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, shopItemId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";

  // Owner-scope via the parent collection.
  const shop = await prisma.collectionShopItem.findFirst({
    where: { id: shopItemId, collectionId: id, collection: { ownerId: userId } },
  });
  if (!shop) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!shop.imagePath) {
    return NextResponse.json(
      {
        error:
          "This product doesn't have a photo yet. Tap 📷 Replace photo to add one, then try again.",
      },
      { status: 400 },
    );
  }

  const mannequin = await loadMannequinFor(userId);
  if (!mannequin) {
    return NextResponse.json(
      {
        error:
          "No mannequin available. Upload a photo in Settings → Your mannequin, or run `npm run generate:mannequin` to create the global default.",
      },
      { status: 500 },
    );
  }

  // Hash inputs: mannequin id, shop item id, image mtime, prompt
  // version. Replacing the photo bumps mtime → hash changes →
  // regenerate. Bumping the user's mannequin → mannequin id changes
  // → regenerate. Same shape the outfit route uses.
  const imageAbsPath = path.join(UPLOAD_ROOT, shop.imagePath);
  let mtime: number | null = null;
  try {
    const s = await fs.stat(imageAbsPath);
    mtime = Math.floor(s.mtimeMs);
  } catch {
    return NextResponse.json(
      { error: "Couldn't read this product's photo from disk." },
      { status: 500 },
    );
  }
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        mq: mannequin.id,
        item: shop.id,
        path: shop.imagePath,
        mtime,
        promptVersion: TRY_ON_PROMPT_VERSION,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  if (!force && shop.tryOnHash === hash && shop.tryOnImagePath) {
    return NextResponse.json({
      tryOnImagePath: shop.tryOnImagePath,
      tryOnGeneratedAt: shop.tryOnGeneratedAt,
      hash,
      fromCache: true,
    });
  }

  if (inflight.has(shop.id)) {
    return NextResponse.json(
      { error: "A try-on is already generating for this item." },
      { status: 409 },
    );
  }
  inflight.add(shop.id);

  try {
    // Read the product image. Body for generateTryOn is `Buffer`;
    // mime sniffed from the extension.
    const imageBuf = await fs.readFile(imageAbsPath);
    const imageMime = mimeFor(shop.imagePath);

    // Map the shop item's category to a slot. Many shop items have a
    // valid category from the metadata extractor; falls back to "top"
    // when the category is missing or unknown — Gemini still figures
    // it out from the image, and "top" is the safest slot label
    // (least restrictive prompt-side).
    const slot: Slot = shop.category
      ? slotForItem(shop.category, null)
      : "top";

    const garment: TryOnGarment = {
      imageBuf,
      imageMime,
      // Shop-item photos almost always include some background — Amazon
      // screenshots have UI chrome, og:images have studio backdrops,
      // user uploads have whatever they shot against. Tell Gemini's
      // try-on prompt to extract only the garment.
      hasBackground: true,
      pieces: [
        {
          id: shop.id,
          slot,
          category: shop.category ?? "Tops",
          subType: shop.name,
          color: shop.color,
        },
      ],
    };

    const result = await generateTryOn({
      mannequinBuf: mannequin.buf,
      mannequinMime: "image/png",
      garments: [garment],
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, debug: result.debug },
        { status: 502 },
      );
    }

    const ext = result.mimeType === "image/jpeg" ? "jpg" : "png";
    const newPath = await saveBuffer(
      userId,
      shop.id,
      result.pngBuffer,
      `tryon-${hash}`,
      ext,
    );

    const oldPath = shop.tryOnImagePath;
    const updated = await prisma.collectionShopItem.update({
      where: { id: shop.id },
      data: {
        tryOnImagePath: newPath,
        tryOnHash: hash,
        tryOnGeneratedAt: new Date(),
      },
    });

    if (oldPath && oldPath !== newPath) {
      await unlinkUpload(oldPath);
    }

    await logActivity({
      userId,
      kind: "ai.tryon",
      summary: `Generated AI try-on for shop item "${shop.name}"`,
      targetType: "CollectionShopItem",
      targetId: shop.id,
    });

    return NextResponse.json({
      tryOnImagePath: updated.tryOnImagePath,
      tryOnGeneratedAt: updated.tryOnGeneratedAt,
      hash,
      fromCache: false,
    });
  } finally {
    inflight.delete(shop.id);
  }
}
