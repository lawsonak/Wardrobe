// "Shop for this trip" — pipeline orchestrator.
//
// Stage 1 (lib/ai/collectionShop.ts): Gemini reads the trip + closet +
// weather + packing targets and returns 3-12 product SPECS — search
// query, category, color, brand hint, price tier, reasoning.
//
// Stage 2 (this file, via lib/retailerSearch.ts): for each spec we
// pick a few retailers that fit the price tier and category, build
// retailer-search URLs with the spec's query, and surface them as a
// single shopping idea card the user can click into.
//
// Why retailer redirects instead of grounded search or a direct
// product-search API: Google closed the Custom Search JSON API to new
// customers in 2025, and Gemini's grounded search returns stale URLs
// from its training cutoff. A search-page redirect is free, doesn't
// hallucinate, doesn't go stale (retailers update their own search),
// and works against bot-blocking sites because the user opens them
// in their normal browser session.

import {
  specifyProductsForCollection,
  type ProductSpec,
  type ShopRequest,
} from "@/lib/ai/collectionShop";
import {
  buildRetailerSearchUrl,
  buildShoppingSearchUrl,
  pickRetailersForSpec,
  type Retailer,
} from "@/lib/retailerSearch";

const RETAILERS_PER_SPEC = 3;

export type RetailerLink = {
  id: string;
  name: string;
  host: string;
  searchUrl: string;
};

export type ShopIdea = {
  /** Short title — usually the spec's searchQuery. */
  title: string;
  /** Higher-level category, used for grouping in the UI. */
  category: string | null;
  color: string | null;
  /** Brand hint from Gemini (may differ from any retailer in the list). */
  brandHint: string | null;
  /** Indicative price tier, when the model gave one. */
  priceTier: string | null;
  /** 1-2 sentences from Gemini on why this fits the trip + closet. */
  reasoning: string;
  /** The exact text we'd hand a wishlist row's `name` field. */
  searchQuery: string;
  /** Retailer search-page links the user can open. */
  retailers: RetailerLink[];
  /** Google Shopping fallback link (no site restriction) — per-retailer
   *  site-searches occasionally return zero results, so we always give
   *  the user one chip that's guaranteed to surface real products. */
  shoppingUrl: string;
};

export type PipelineDebug = {
  specsRequested: number;
  ideasReturned: number;
  /** Specs we couldn't map to any retailer. Should be 0 in practice
   *  since the picker has a mid-tier fallback, but worth tracking. */
  specsWithoutRetailers: number;
};

export type PipelineResult =
  | { ok: true; ideas: ShopIdea[]; specs: ProductSpec[]; debug: PipelineDebug }
  | { ok: false; error: string; debug: PipelineDebug };

export async function runShopPipeline(req: ShopRequest): Promise<PipelineResult> {
  const debug: PipelineDebug = {
    specsRequested: 0,
    ideasReturned: 0,
    specsWithoutRetailers: 0,
  };

  const specResult = await specifyProductsForCollection(req);
  if (!specResult.ok) {
    return { ok: false, error: specResult.error, debug };
  }

  const specs = specResult.specs;
  debug.specsRequested = specs.length;

  const ideas: ShopIdea[] = [];
  for (const spec of specs) {
    const retailers = pickRetailersForSpec(spec, RETAILERS_PER_SPEC);
    if (retailers.length === 0) {
      debug.specsWithoutRetailers++;
      continue;
    }
    ideas.push(buildIdea(spec, retailers));
  }
  debug.ideasReturned = ideas.length;

  if (ideas.length === 0) {
    return {
      ok: false,
      error:
        "The AI generated product ideas but couldn't match any of them to a retailer. This shouldn't happen — let me know if it does.",
      debug,
    };
  }

  return { ok: true, ideas, specs, debug };
}

function buildIdea(spec: ProductSpec, retailers: Retailer[]): ShopIdea {
  return {
    title: spec.searchQuery,
    category: spec.category,
    color: spec.color,
    brandHint: spec.brandHint,
    priceTier: spec.priceTier,
    reasoning: spec.reasoning,
    searchQuery: spec.searchQuery,
    retailers: retailers.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      searchUrl: buildRetailerSearchUrl(r.host, spec.searchQuery),
    })),
    shoppingUrl: buildShoppingSearchUrl(spec.searchQuery),
  };
}
