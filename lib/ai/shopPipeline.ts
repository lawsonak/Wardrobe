// "Shop for this trip" — pipeline orchestrator. Three stages:
//
//   Stage 1 (lib/ai/collectionShop.ts): Gemini → product SPECS, no URLs.
//   Stage 2 (this file, via lib/productSearch.ts): Google CSE → real URLs.
//   Stage 3 (this file, via lib/productMeta.ts): fetch + parse each URL.
//
// Stage 3 outcomes per CSE hit:
//   - VERIFIED   — fetched the page, JSON-LD or OG metadata present.
//                  Use the rich data for the card.
//   - UNVERIFIED — page exists (HEAD/GET succeeded) but we couldn't
//                  parse it (bot-block, no embedded metadata). Build a
//                  card from the CSE hit itself (title, thumbnail,
//                  displayLink) and flag it so the UI shows a small
//                  "couldn't verify" hint.
//   - DROPPED    — URL is dead (4xx/5xx) or shaped like a search /
//                  category landing page, not a product page.
//
// We track *why* hits get dropped so the UI can show actionable error
// messages instead of "couldn't validate any of the products".

import {
  specifyProductsForCollection,
  type ProductSpec,
  type ShopRequest,
} from "@/lib/ai/collectionShop";
import { searchProducts, isCSEConfigured, type SearchHit } from "@/lib/productSearch";
import { fetchProductMeta } from "@/lib/productMeta";

const MAX_HITS_PER_SPEC = 3;
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
  /** True when we couldn't parse the page metadata (bot-block, missing
   *  JSON-LD/OG). The card still links and shows the CSE thumbnail,
   *  but price/brand may be missing — UI surfaces a "couldn't verify"
   *  hint and the user clicks through to confirm. */
  isUnverified: boolean;
};

type DropReason =
  | "non-product url"
  | "http error"
  | "blocked"
  | "no metadata"
  | "non-html"
  | "network"
  | "other";

type Outcome =
  | { kind: "verified"; product: ShopProduct }
  | { kind: "unverified"; product: ShopProduct }
  | { kind: "dropped"; reason: DropReason; detail?: string };

export type PipelineDebug = {
  specsRequested: number;
  cseHitsReturned: number;
  /** Specs whose CSE search returned 0 hits. */
  specsWithNoHits: number;
  hitsVerified: number;
  hitsUnverified: number;
  hitsDropped: number;
  /** Per-reason breakdown of dropped hits. */
  dropReasons: Record<DropReason, number>;
  cseConfigured: boolean;
};

export type PipelineResult =
  | {
      ok: true;
      products: ShopProduct[];
      specs: ProductSpec[];
      /** Plain-English notes worth showing to the user — e.g. "3 sites
       *  blocked our scraper, click through to verify those." */
      notes: string[];
      debug: PipelineDebug;
    }
  | { ok: false; error: string; debug: PipelineDebug };

function emptyDebug(cseConfigured: boolean): PipelineDebug {
  return {
    specsRequested: 0,
    cseHitsReturned: 0,
    specsWithNoHits: 0,
    hitsVerified: 0,
    hitsUnverified: 0,
    hitsDropped: 0,
    dropReasons: {
      "non-product url": 0,
      "http error": 0,
      blocked: 0,
      "no metadata": 0,
      "non-html": 0,
      network: 0,
      other: 0,
    },
    cseConfigured,
  };
}

export async function runShopPipeline(req: ShopRequest): Promise<PipelineResult> {
  const cseConfigured = isCSEConfigured();
  if (!cseConfigured) {
    return {
      ok: false,
      error:
        "Product search isn't configured on this server. Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID and configure your Programmable Search Engine with the retailers you want to search.",
      debug: emptyDebug(false),
    };
  }

  const debug = emptyDebug(true);

  const specResult = await specifyProductsForCollection(req);
  if (!specResult.ok) {
    return { ok: false, error: specResult.error, debug };
  }
  const specs = specResult.specs;
  debug.specsRequested = specs.length;

  // Resolve specs in parallel with bounded concurrency. Each worker
  // mutates `debug` directly — they only ever increment counters so
  // the lack of locking is fine in Node's single-threaded event loop.
  const products = await runWithConcurrency(specs, FETCH_CONCURRENCY, (spec) =>
    resolveSpec(spec, debug),
  );
  const ok = products.filter((p): p is ShopProduct => p !== null);

  if (ok.length === 0) {
    return { ok: false, error: explainEmpty(debug), debug };
  }

  return {
    ok: true,
    products: ok,
    specs,
    notes: buildNotes(debug),
    debug,
  };
}

async function resolveSpec(
  spec: ProductSpec,
  debug: PipelineDebug,
): Promise<ShopProduct | null> {
  const queryParts = [spec.searchQuery];
  if (spec.brandHint && !spec.searchQuery.toLowerCase().includes(spec.brandHint.toLowerCase())) {
    queryParts.push(spec.brandHint);
  }
  const query = queryParts.join(" ");

  const search = await searchProducts(query, { num: MAX_HITS_PER_SPEC });
  if (!search.ok) {
    debug.specsWithNoHits++;
    return null;
  }
  if (search.hits.length === 0) {
    debug.specsWithNoHits++;
    return null;
  }

  debug.cseHitsReturned += search.hits.length;

  // Walk hits in CSE-relevance order; keep the first one that's at
  // least usable (verified OR unverified). Unverified-but-linkable
  // beats nothing, but if a verified hit comes first we prefer it.
  let fallback: ShopProduct | null = null;
  for (const hit of search.hits) {
    const outcome = await validateHit(hit, spec);
    if (outcome.kind === "verified") {
      debug.hitsVerified++;
      return outcome.product;
    }
    if (outcome.kind === "unverified") {
      debug.hitsUnverified++;
      if (!fallback) fallback = outcome.product;
      continue;
    }
    debug.hitsDropped++;
    debug.dropReasons[outcome.reason] = (debug.dropReasons[outcome.reason] ?? 0) + 1;
  }
  return fallback;
}

async function validateHit(hit: SearchHit, spec: ProductSpec): Promise<Outcome> {
  if (looksLikeNonProductUrl(hit.url)) {
    return { kind: "dropped", reason: "non-product url" };
  }

  const meta = await fetchProductMeta(hit.url);
  if (meta.ok) {
    return { kind: "verified", product: buildVerifiedProduct(hit, spec, meta.meta) };
  }

  // Decide whether the hit is dead (drop) or just unparseable (fall back).
  const status = meta.debug.status;
  if (typeof status === "number" && status >= 400) {
    return { kind: "dropped", reason: "http error", detail: `HTTP ${status}` };
  }
  const reason = meta.debug.reason ?? "";
  if (reason === "blocked page") {
    return { kind: "unverified", product: buildCSEProduct(hit, spec) };
  }
  if (reason === "no og/json-ld") {
    return { kind: "unverified", product: buildCSEProduct(hit, spec) };
  }
  if (reason.startsWith("content-type:")) {
    return { kind: "dropped", reason: "non-html" };
  }
  if (reason.startsWith("HTTP ")) {
    return { kind: "dropped", reason: "http error", detail: reason };
  }
  // Bucket anything else (network errors, timeouts, "Couldn't reach X")
  // as a network failure — same outcome (drop) but separately countable.
  return { kind: "dropped", reason: "network", detail: reason };
}

function buildVerifiedProduct(
  hit: SearchHit,
  spec: ProductSpec,
  meta: { name?: string; brand?: string; price?: string; imageUrl?: string; productUrl?: string; source?: string },
): ShopProduct {
  const productName = meta.name || stripTitleSuffix(hit.title) || spec.searchQuery;
  const brand = meta.brand ?? spec.brandHint ?? null;
  const vendor = meta.source ?? hit.displayLink ?? null;
  return {
    productName: productName.slice(0, 200),
    brand: brand ? brand.slice(0, 120) : null,
    vendor:
      vendor && (!brand || vendor.toLowerCase() !== brand.toLowerCase())
        ? vendor.slice(0, 120)
        : null,
    productUrl: meta.productUrl ?? hit.url,
    category: spec.category,
    color: spec.color,
    estimatedPrice: meta.price ?? null,
    reasoning: spec.reasoning,
    imageUrl: meta.imageUrl ?? hit.thumbnailUrl ?? null,
    isUnverified: false,
  };
}

function buildCSEProduct(hit: SearchHit, spec: ProductSpec): ShopProduct {
  const productName = stripTitleSuffix(hit.title) || spec.searchQuery;
  const brandFromTitle = brandFromTitleSuffix(hit.title);
  const brand = spec.brandHint ?? brandFromTitle ?? null;
  const vendor = hit.displayLink || null;
  return {
    productName: productName.slice(0, 200),
    brand: brand ? brand.slice(0, 120) : null,
    vendor:
      vendor && (!brand || vendor.toLowerCase() !== brand.toLowerCase())
        ? vendor.slice(0, 120)
        : null,
    productUrl: hit.url,
    category: spec.category,
    color: spec.color,
    estimatedPrice: null,
    reasoning: spec.reasoning,
    imageUrl: hit.thumbnailUrl ?? null,
    isUnverified: true,
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

function stripTitleSuffix(title: string): string | null {
  if (!title) return null;
  const cut = title.split(/\s[|–—-]\s/)[0]?.trim();
  return cut || null;
}

// "Linen Blazer | Madewell" → "Madewell". Best effort — if there's no
// pipe/dash separator we don't try to guess.
function brandFromTitleSuffix(title: string): string | null {
  if (!title) return null;
  const parts = title.split(/\s[|–—-]\s/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  if (!last || last.length > 40) return null;
  return last;
}

function explainEmpty(debug: PipelineDebug): string {
  if (debug.specsRequested === 0) {
    return "The AI didn't return any product ideas. Try a different intensity slider position.";
  }
  if (debug.cseHitsReturned === 0) {
    return [
      `Generated ${debug.specsRequested} product idea${debug.specsRequested === 1 ? "" : "s"} but Google's search returned zero hits across the board.`,
      "Open https://programmablesearchengine.google.com/, find your search engine, and check that:",
      "• 'Search the entire web' is OFF",
      "• 'Sites to search' has the retailer domains added (madewell.com, jcrew.com, etc.)",
    ].join(" ");
  }

  const reasons = debug.dropReasons;
  const breakdown: string[] = [];
  if (reasons.blocked > 0) breakdown.push(`${reasons.blocked} blocked by retailer bot-checks`);
  if (reasons["http error"] > 0) breakdown.push(`${reasons["http error"]} dead links`);
  if (reasons["no metadata"] > 0) breakdown.push(`${reasons["no metadata"]} had no product schema`);
  if (reasons["non-product url"] > 0)
    breakdown.push(`${reasons["non-product url"]} weren't product pages`);
  if (reasons["non-html"] > 0) breakdown.push(`${reasons["non-html"]} weren't HTML`);
  if (reasons.network > 0) breakdown.push(`${reasons.network} network errors`);
  if (reasons.other > 0) breakdown.push(`${reasons.other} other`);

  return [
    `Generated ${debug.specsRequested} product ideas, got ${debug.cseHitsReturned} search hits, but none survived validation`,
    breakdown.length > 0 ? `(${breakdown.join(", ")}).` : ".",
    "Most common cause: the search engine is configured to 'Search the entire web' instead of 'Search only included sites' — open it at programmablesearchengine.google.com and toggle the setting.",
  ].join(" ");
}

function buildNotes(debug: PipelineDebug): string[] {
  const notes: string[] = [];
  if (debug.hitsUnverified > 0) {
    notes.push(
      `${debug.hitsUnverified} result${debug.hitsUnverified === 1 ? "" : "s"} couldn't be fully verified (the retailer blocked our scraper or didn't expose product data) — click through to confirm price and stock.`,
    );
  }
  if (debug.specsWithNoHits > 0) {
    notes.push(
      `${debug.specsWithNoHits} of ${debug.specsRequested} product ideas had no matches in your search engine — add more retailers if you want broader coverage.`,
    );
  }
  return notes;
}

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
