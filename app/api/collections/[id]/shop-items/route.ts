import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { lookupWishlistProduct, type WishlistLookupSuggestion } from "@/lib/ai/wishlistLookup";
import { fetchProductMeta } from "@/lib/productMeta";
import { saveRemoteImage } from "@/lib/remoteImage";
import { validateUploadFile } from "@/lib/uploads";
import { getProvider } from "@/lib/ai/provider";
import { isKnownCategory, COLOR_NAMES } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// Direct fetch + (fallback) grounded search + image download can take a
// few seconds per link. The client fires one request per pasted link
// sequentially, so each request stays short; this is headroom.
export const maxDuration = 60;

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const DISPLAY_MAX_EDGE_PX = 1024;
// Padding around the Gemini box on photo-create — matches the photo-
// replace route's value so we don't ship two different crop policies.
const PAD_PCT = 0.04;

// Accept https:// URLs and bare domains ("madewell.com/...").
const URL_RE = /^https?:\/\//i;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;

function looksLikeUrl(s: string): boolean {
  return URL_RE.test(s) || BARE_DOMAIN_RE.test(s);
}

// Last-resort name when the page exposed no title: "Item from madewell.com".
function fallbackName(source: string | undefined): string {
  return source ? `Item from ${source}` : "Saved item";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const collection = await prisma.collection.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Three input shapes — content-type dispatched:
  //   - multipart/form-data with `image` File → photo-only create, AI
  //     auto-detects + tags the garment. No link yet; user can add one
  //     later via PATCH. This is the path for "saw something in a store /
  //     on Pinterest / on Amazon-blocked-scraping" cases.
  //   - JSON `{ link }`               → paste-link path (fetch page meta)
  //   - JSON `{ name, ...fields }`    → manual fields (used by AI shop)
  //
  // The earlier two were already in place; the multipart path is new.
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return handlePhotoCreate(req, userId, collection);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Two ways to add a shop item:
  //   1. `link` only — fetch the product page via lookupWishlistProduct
  //      (Open Graph / JSON-LD direct first, Gemini grounded-search
  //      fallback for sites that block scraping). The user-pasted-link
  //      path.
  //   2. Explicit `name` (+ optional brand/category/color/price/link/
  //      imageUrl/notes) — skip the fetch and store as-is. Used by the
  //      "Save to collection" button on the AI shop suggestions panel,
  //      where Gemini already produced all the structured fields and
  //      hitting the page again would be wasteful (and the link is
  //      typically a Google site-search URL, not a real product page).
  const linkRaw = typeof body.link === "string" ? body.link.trim() : "";
  const manualName = typeof body.name === "string" ? body.name.trim() : "";

  let s: WishlistLookupSuggestion;
  let imageUrl: string | undefined;
  let canonicalLink: string;

  if (manualName) {
    s = {
      name: manualName,
      brand: pickString(body.brand),
      category: pickString(body.category),
      color: pickString(body.color),
      price: pickString(body.price),
      link: linkRaw || undefined,
      description: pickString(body.notes),
      source: linkRaw ? hostOf(linkRaw) : undefined,
    };
    imageUrl = pickString(body.imageUrl);
    canonicalLink = linkRaw;
  } else {
    if (!linkRaw) {
      return NextResponse.json({ error: "Paste a product link." }, { status: 400 });
    }
    if (!looksLikeUrl(linkRaw)) {
      return NextResponse.json(
        { error: "That doesn't look like a link. Paste the full product URL (e.g. https://…)." },
        { status: 400 },
      );
    }
    const resolved = await resolveProduct(linkRaw);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "Couldn't pull that product. The site may block automated reads — try the brand's own product page, or add it manually.",
        },
        { status: 502 },
      );
    }
    s = resolved;
    imageUrl = s.imageUrl;
    canonicalLink = linkRaw;
  }

  const source = s.source ?? hostOf(s.link ?? canonicalLink);
  const name = (s.name?.trim() || fallbackName(source)).slice(0, 120);

  const created = await prisma.collectionShopItem.create({
    data: {
      collectionId: id,
      name,
      brand: s.brand?.slice(0, 80) ?? null,
      category: s.category?.slice(0, 60) ?? null,
      color: s.color?.slice(0, 40) ?? null,
      price: s.price?.slice(0, 60) ?? null,
      link: (s.link ?? canonicalLink).slice(0, 2000),
      source: source?.slice(0, 120) ?? null,
      notes: s.description?.slice(0, 600) ?? null,
    },
  });

  // Best-effort product thumbnail — direct-fetch and AI-save both
  // provide an image URL when one's available. Any failure leaves
  // imagePath null and the card renders a placeholder.
  let imagePath: string | null = null;
  if (imageUrl) {
    imagePath = await saveRemoteImage({
      userId,
      subdir: "collection-shop",
      basename: `${created.id}-img`,
      imageUrl,
    });
    if (imagePath) {
      await prisma.collectionShopItem.update({ where: { id: created.id }, data: { imagePath } });
    }
  }

  await logActivity({
    userId,
    kind: "collection.shopitem.add",
    summary: `Saved "${name}" to ${collection.name}'s shopping list`,
    targetType: "Collection",
    targetId: id,
  });

  return NextResponse.json({ item: { ...created, imagePath } });
}

// Resolve a pasted link into a normalized suggestion. Prefers the full
// AI-backed wishlist lookup; falls back to a no-AI direct Open Graph /
// JSON-LD fetch when GEMINI_API_KEY isn't set. Returns null when nothing
// usable could be extracted.
async function resolveProduct(link: string): Promise<WishlistLookupSuggestion | null> {
  if (process.env.GEMINI_API_KEY) {
    const lookup = await lookupWishlistProduct({ query: link });
    return lookup.ok ? lookup.suggestions : null;
  }
  // AI off — direct fetch only (no category/color inference).
  const meta = await fetchProductMeta(URL_RE.test(link) ? link : `https://${link}`);
  if (!meta.ok) return null;
  return {
    name: meta.meta.name,
    brand: meta.meta.brand,
    link: meta.meta.productUrl ?? link,
    price: meta.meta.price,
    description: meta.meta.description,
    imageUrl: meta.meta.imageUrl,
    source: meta.meta.source,
  };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(URL_RE.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// Narrow an `unknown` request-body field to a non-empty trimmed string,
// or undefined. Keeps the POST handler's branching readable.
function pickString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

// Photo-only creation. The user uploads a photo (typically a screenshot
// from a store website, Pinterest, or a social-media find) and we run
// it through Gemini's object detection — same call that powers the
// closet's "✂ Split photo" feature. Each detection comes with a
// TagSuggestion attached, so one Gemini call gives us BOTH the crop
// region AND the auto-tags (name / category / color / brand).
//
// Detection-empty / AI-off / detection-error all fall through to
// "save the uncropped upload + no metadata" — the row still exists,
// and the user can fill the fields in later via PATCH.
async function handlePhotoCreate(
  req: NextRequest,
  userId: string,
  collection: { id: string; name: string },
): Promise<NextResponse> {
  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  const fileErr = validateUploadFile(image);
  if (fileErr) return NextResponse.json({ error: fileErr }, { status: 400 });

  const sourceBytes = Buffer.from(await image.arrayBuffer());

  // One AI call gives us BOTH the crop region and the auto-tag
  // suggestion. detectMultipleItems returns DetectedItem[], each with
  // { box, suggestion: TagSuggestion }.
  let cropBuf: Buffer | null = null;
  let detectionUsed = false;
  const suggestion: {
    category?: string;
    subType?: string;
    color?: string;
    brand?: string;
  } = {};
  const provider = getProvider();
  if (provider.available() && typeof provider.detectMultipleItems === "function") {
    try {
      const meta = await sharp(sourceBytes, { failOn: "none" }).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      if (W > 0 && H > 0) {
        // Re-encode as a clean JPEG for detection so Gemini doesn't
        // choke on HEIC or weird color profiles.
        const detectJpeg = await sharp(sourceBytes, { failOn: "none" })
          .rotate()
          .jpeg({ quality: 88 })
          .toBuffer();
        const detectBlob = new Blob([new Uint8Array(detectJpeg)], { type: "image/jpeg" });
        const result = await provider.detectMultipleItems({ image: detectBlob });
        // Pick the largest detected box — when a user uploads a single
        // product screenshot there's usually one dominant garment.
        let bestIdx = -1;
        let bestArea = 0;
        for (let i = 0; i < result.items.length; i++) {
          const [ymin, xmin, ymax, xmax] = result.items[i].box;
          const area = (ymax - ymin) * (xmax - xmin);
          if (area > bestArea) {
            bestArea = area;
            bestIdx = i;
          }
        }
        // 5% minimum area guard — stops the model from latching onto a
        // logo or icon and producing a pixel-level crop.
        if (bestIdx >= 0 && bestArea / 1_000_000 > 0.05) {
          const best = result.items[bestIdx];
          const pad = Math.round(PAD_PCT * Math.min(W, H));
          const [ymin, xmin, ymax, xmax] = best.box;
          const left = Math.max(0, Math.round((xmin / 1000) * W) - pad);
          const top = Math.max(0, Math.round((ymin / 1000) * H) - pad);
          const right = Math.min(W, Math.round((xmax / 1000) * W) + pad);
          const bottom = Math.min(H, Math.round((ymax / 1000) * H) + pad);
          const cw = right - left;
          const ch = bottom - top;
          if (cw > 0 && ch > 0) {
            cropBuf = await sharp(sourceBytes, { failOn: "none" })
              .rotate()
              .extract({ left, top, width: cw, height: ch })
              .resize({
                width: DISPLAY_MAX_EDGE_PX,
                height: DISPLAY_MAX_EDGE_PX,
                fit: "inside",
                withoutEnlargement: true,
              })
              .jpeg({ quality: 88, mozjpeg: true })
              .toBuffer();
            detectionUsed = true;
            // Lift the per-detection TagSuggestion fields onto the
            // new shop item — same data shape the closet's split
            // route already trusts from this detector. Beauty-only
            // fields are ignored here since shop items don't surface
            // shade / finish today.
            const s = best.suggestion;
            if (s.category && isKnownCategory(s.category)) {
              suggestion.category = s.category;
            }
            if (s.subType && typeof s.subType === "string") {
              suggestion.subType = s.subType.trim().slice(0, 100);
            }
            if (s.color && typeof s.color === "string") {
              const lower = s.color.toLowerCase().trim();
              if ((COLOR_NAMES as readonly string[]).includes(lower)) {
                suggestion.color = lower;
              }
            }
            if (s.brand && typeof s.brand === "string") {
              suggestion.brand = s.brand.trim().slice(0, 80);
            }
          }
        }
      }
    } catch (err) {
      console.error("shop-item photo-create detect failed:", err);
    }
  }

  // Fallback: save the rotated + resized upload as-is when detection
  // didn't fire or returned nothing useful. The row still gets created;
  // the user fills in the fields via PATCH.
  if (!cropBuf) {
    cropBuf = await sharp(sourceBytes, { failOn: "none" })
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE_PX,
        height: DISPLAY_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }

  // Best human-readable name: subType ("Linen blazer") > brand+category
  // ("Madewell · Outerwear") > "Saved item". Truncated at 120 to
  // match the same cap the link path uses.
  const name = (
    suggestion.subType ||
    [suggestion.brand, suggestion.category].filter(Boolean).join(" · ") ||
    "Saved photo"
  ).slice(0, 120);

  // Create the row first with a placeholder imagePath so we have a
  // stable id to name the file with — mirrors the closet's POST
  // pattern. If the file write fails downstream, we delete the row.
  const created = await prisma.collectionShopItem.create({
    data: {
      collectionId: collection.id,
      name,
      brand: suggestion.brand ?? null,
      category: suggestion.category ?? null,
      color: suggestion.color ?? null,
      price: null,
      link: null,
      imagePath: "pending",
      source: null,
      notes: null,
    },
  });

  try {
    const userDir = path.join(UPLOAD_ROOT, userId, "collection-shop");
    await fs.mkdir(userDir, { recursive: true });
    const stamp = Date.now().toString(36);
    const filename = `${created.id}-img-${stamp}.jpg`;
    await fs.writeFile(path.join(userDir, filename), cropBuf);
    const relPath = path.posix.join(userId, "collection-shop", filename);
    const finalRow = await prisma.collectionShopItem.update({
      where: { id: created.id },
      data: { imagePath: relPath },
    });

    await logActivity({
      userId,
      kind: "collection.shopitem.add",
      summary: `Added a photo to ${collection.name}'s shopping list`,
      targetType: "Collection",
      targetId: collection.id,
    });

    return NextResponse.json({ item: finalRow, detectionUsed });
  } catch (err) {
    // File write failed — clean up the orphan row so the user doesn't
    // see a placeholder card with no image.
    await prisma.collectionShopItem.delete({ where: { id: created.id } }).catch(() => {});
    console.error("shop-item photo-create save failed:", err);
    return NextResponse.json(
      { error: "Couldn't save that photo. Try again?" },
      { status: 500 },
    );
  }
}
