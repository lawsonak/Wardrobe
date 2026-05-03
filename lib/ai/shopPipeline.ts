// "Shop for this trip" — pipeline orchestrator. Three stages:
//
//   Stage 1 (lib/ai/collectionShop.ts): Gemini → product SPECS, no URLs.
//   Stage 2 (this file, via lib/productSearch.ts): Google CSE → real URLs.
//   Stage 3 (this file, via lib/productMeta.ts): fetch + parse each URL,
//           drop dead/blocked pages, replace imageUrl with og:image,
//           upgrade price/brand from JSON-LD when present.
//
// The result is a list of ShopProduct cards backed by current inventory
// from a curated retailer allowlist (configured in the user's Google
// Programmable Search Engine).

import {
  specifyProductsForCollection,
  type ProductSpec,
  type ShopRequest,
} from "@/lib/ai/collectionShop";
import { searchProducts, isCSEConfigured, type SearchHit } from "@/lib/productSearch";
import { fetchProductMeta } from "@/lib/productMeta";

// How many CSE hits per spec we'll try before giving up. Bumping this
// hits the daily quota faster; 3 is enough since CSE returns the most
// relevant first. If hit #1 is alive, we use it and don't fetch the rest.
const MAX_HITS_PER_SPEC = 3;

// Bound concurrency so we don't hammer 12 retailers simultaneously and
// trip rate limits. 4 is a polite ceiling.
const FETCH_CONCURRENCY = 4;

export type ShopProduct = {
  productName: string;
  brand: string | null;
  vendor: string | null;
  productUrl: string;
  category: string | null;
  color: string | null;
  estimatedPrice: string | null;
  reasoning: string;
  imageUrl: string | null;
};

export type PipelineDebug = {
  specsRequested: number;
  specsValidated: number;
  hitsTried: number;
  hitsFailed: number;
  cseConfigured: boolean;
  reason?: string;
};

export type PipelineResult =
  | { ok: true; products: ShopProduct[]; specs: ProductSpec[]; debug: PipelineDebug }
  | { ok: false; error: string; debug: PipelineDebug };

export async function runShopPipeline(req: ShopRequest): Promise<PipelineResult> {
  const cseConfigured = isCSEConfigured();
  if (!cseConfigured) {
    return {
      ok: false,
      error:
        "Product search isn't configured on this server. Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID and configure your Programmable Search Engine with the retailers you want to search.",
      debug: {
        specsRequested: 0,
        specsValidated: 0,
        hitsTried: 0,
        hitsFailed: 0,
        cseConfigured: false,
        reason: "CSE not configured",
      },
    };
  }

  // Stage 1 — Gemini specs the products.
  const specResult = await specifyProductsForCollection(req);
  if (!specResult.ok) {
    return {
      ok: false,
      error: specResult.error,
      debug: {
        specsRequested: 0,
        specsValidated: 0,
        hitsTried: 0,
        hitsFailed: 0,
        cseConfigured,
        reason: `stage1: ${specResult.error}`,
      },
    };
  }
  const specs = specResult.specs;

  // Stage 2 + 3 — for each spec, pull CSE hits and validate them. Run
  // specs in parallel with a bounded worker pool so a slow retailer
  // doesn't bottleneck the whole search.
  const tally = { tried: 0, failed: 0 };
  const products = await runWithConcurrency(specs, FETCH_CONCURRENCY, (spec) =>
    resolveSpec(spec, tally),
  );
  const ok = products.filter((p): p is ShopProduct => p !== null);

  if (ok.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't validate any of the products the AI suggested. Either every retailer in your search engine is offline or the search engine config is too narrow — open it at programmablesearchengine.google.com and add a few more sites.",
      debug: {
        specsRequested: specs.length,
        specsValidated: 0,
        hitsTried: tally.tried,
        hitsFailed: tally.failed,
        cseConfigured,
        reason: "no validated products",
      },
    };
  }

  return {
    ok: true,
    products: ok,
    specs,
    debug: {
      specsRequested: specs.length,
      specsValidated: ok.length,
      hitsTried: tally.tried,
      hitsFailed: tally.failed,
      cseConfigured,
    },
  };
}

// Resolve a single spec to a validated ShopProduct (or null if every
// CSE hit fails to load / parse). Walks hits in order — CSE returns
// the most relevant first — and stops at the first one we can prove
// is a real product page.
async function resolveSpec(
  spec: ProductSpec,
  tally: { tried: number; failed: number },
): Promise<ShopProduct | null> {
  // Bias the query toward an actual product page by including the brand
  // hint when we have one and a year-ish recency hint to favor current
  // inventory. CSE itself does most of the freshness work.
  const queryParts = [spec.searchQuery];
  if (spec.brandHint && !spec.searchQuery.toLowerCase().includes(spec.brandHint.toLowerCase())) {
    queryParts.push(spec.brandHint);
  }
  const query = queryParts.join(" ");

  const search = await searchProducts(query, { num: MAX_HITS_PER_SPEC });
  if (!search.ok) return null;

  for (const hit of search.hits) {
    tally.tried++;
    const validated = await validateHit(hit, spec);
    if (validated) return validated;
    tally.failed++;
  }
  return null;
}

async function validateHit(
  hit: SearchHit,
  spec: ProductSpec,
): Promise<ShopProduct | null> {
  // Skip obvious non-product pages — search/category landing pages,
  // homepages, blogs. The retailer allowlist already narrows the space,
  // but CSE still surfaces the occasional category page.
  if (looksLikeNonProductUrl(hit.url)) return null;

  const meta = await fetchProductMeta(hit.url);
  if (!meta.ok) return null;

  // The CSE hit + JSON-LD/OG together give us a much stronger signal
  // than either alone. Prefer JSON-LD's brand and price (formatted),
  // CSE's title as a tiebreaker for the display name.
  const productName = meta.meta.name || stripTitleSuffix(hit.title) || spec.searchQuery;
  const brand = meta.meta.brand ?? spec.brandHint ?? null;
  const vendor = meta.meta.source ?? hit.displayLink ?? null;
  const imageUrl = meta.meta.imageUrl ?? hit.thumbnailUrl ?? null;

  return {
    productName: productName.slice(0, 200),
    brand: brand ? brand.slice(0, 120) : null,
    vendor:
      vendor && (!brand || vendor.toLowerCase() !== brand.toLowerCase())
        ? vendor.slice(0, 120)
        : null,
    productUrl: meta.meta.productUrl ?? hit.url,
    category: spec.category,
    color: spec.color,
    estimatedPrice: meta.meta.price ?? null,
    reasoning: spec.reasoning,
    imageUrl,
  };
}

function looksLikeNonProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path === "/" || path === "") return true;
    if (
      /\/(?:search|category|categories|collections?|browse|shop|results?|sale|new(-arrivals)?|all-products?|filters?)\/?$/.test(
        path,
      )
    ) {
      return true;
    }
    if (path.startsWith("/blog") || path.startsWith("/journal") || path.startsWith("/about")) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Strip retailer suffixes from search-result titles ("Linen Blazer | Madewell").
function stripTitleSuffix(title: string): string | null {
  if (!title) return null;
  const cut = title.split(/\s[|–—-]\s/)[0]?.trim();
  return cut || null;
}

// Run an async fn over an array with bounded concurrency. Preserves
// input order in the output array.
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (it: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
