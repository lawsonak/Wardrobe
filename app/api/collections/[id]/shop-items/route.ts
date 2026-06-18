import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { lookupWishlistProduct, type WishlistLookupSuggestion } from "@/lib/ai/wishlistLookup";
import { fetchProductMeta } from "@/lib/productMeta";
import { saveRemoteImage } from "@/lib/remoteImage";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
// Direct fetch + (fallback) grounded search + image download can take a
// few seconds per link. The client fires one request per pasted link
// sequentially, so each request stays short; this is headroom.
export const maxDuration = 60;

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
