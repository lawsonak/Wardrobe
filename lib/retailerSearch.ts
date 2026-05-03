// Curated retailer list for the "Shop for this trip" pipeline. Replaces
// the dead Google Custom Search Engine integration — instead of trying
// to find a specific product URL, we hand the user a search-page link
// for each retailer that fits the spec's price tier and category.
//
// Why we use Google site-search instead of each retailer's native search:
// retailers redesign their search URLs constantly (Madewell, J.Crew,
// SSENSE, Net-a-Porter, Bravissimo all silently broke their `?q=` /
// `?Ntt=` / `?keywords=` patterns at various points). Maintaining a
// per-retailer URL template is whack-a-mole. Google's site-search
// (`google.com/search?q=site:madewell.com+linen+blazer`) always works,
// surfaces real current products from each retailer, and survives any
// number of retailer-side redesigns. Trade-off: the user sees a Google
// results page first and clicks through to the actual product, instead
// of going directly to retailer-internal search.
//
// The selection of retailers is editorial — this is a personal wardrobe
// app, not a marketplace.

// Build a Google site-search URL constrained to a single retailer. We
// always include the host in the visible query (`site:host query`)
// because Google's URL is the only stable contract here. Used directly
// by lib/ai/shopPipeline.ts when assembling retailer chips.
export function buildRetailerSearchUrl(host: string, query: string): string {
  const q = `site:${host} ${query}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Build a Google Shopping search URL with no site restriction. Used as
// the per-idea fallback chip when the per-retailer site-searches whiff
// (Google has zero results for a specific `site:` combo more often
// than you'd think). Shopping has its own product index, surfaces
// real buyable items with images + prices, and almost never returns
// zero results.
export function buildShoppingSearchUrl(query: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

type Tier =
  | "fast-fashion"
  | "mid"
  | "designer"
  | "activewear"
  | "swim"
  | "shoes-bags"
  | "intimates";

export type Retailer = {
  id: string;
  name: string;
  /** Bare hostname like "madewell.com" — used both for display and as
   *  the `site:` constraint on the Google search URL. */
  host: string;
  /** Tiers this retailer fits. A retailer can match multiple. */
  tiers: Tier[];
};

export const RETAILERS: Retailer[] = [
  // ───── Mid-tier (broad coverage) ─────
  { id: "madewell",       name: "Madewell",         host: "madewell.com",        tiers: ["mid"] },
  { id: "jcrew",          name: "J.Crew",           host: "jcrew.com",           tiers: ["mid"] },
  { id: "everlane",       name: "Everlane",         host: "everlane.com",        tiers: ["mid"] },
  { id: "reformation",    name: "Reformation",      host: "thereformation.com",  tiers: ["mid"] },
  { id: "anthropologie",  name: "Anthropologie",    host: "anthropologie.com",   tiers: ["mid"] },
  { id: "freepeople",     name: "Free People",      host: "freepeople.com",      tiers: ["mid"] },
  { id: "aritzia",        name: "Aritzia",          host: "aritzia.com",         tiers: ["mid"] },
  { id: "abercrombie",    name: "Abercrombie",      host: "abercrombie.com",     tiers: ["mid"] },
  { id: "nordstrom",      name: "Nordstrom",        host: "nordstrom.com",       tiers: ["mid", "designer", "shoes-bags"] },
  { id: "boden",          name: "Boden",            host: "boden.com",           tiers: ["mid"] },
  { id: "sezane",         name: "Sézane",           host: "sezane.com",          tiers: ["mid"] },

  // ───── Designer / luxury ─────
  { id: "netaporter",     name: "Net-a-Porter",     host: "net-a-porter.com",    tiers: ["designer"] },
  { id: "ssense",         name: "SSENSE",           host: "ssense.com",          tiers: ["designer"] },
  { id: "mytheresa",      name: "Mytheresa",        host: "mytheresa.com",       tiers: ["designer"] },
  { id: "saks",           name: "Saks Fifth Avenue", host: "saksfifthavenue.com", tiers: ["designer"] },
  { id: "neimanmarcus",   name: "Neiman Marcus",    host: "neimanmarcus.com",    tiers: ["designer"] },
  { id: "shopbop",        name: "Shopbop",          host: "shopbop.com",         tiers: ["designer", "mid"] },

  // ───── Activewear ─────
  { id: "lululemon",      name: "Lululemon",        host: "lululemon.com",       tiers: ["activewear"] },
  { id: "alo",            name: "Alo Yoga",         host: "aloyoga.com",         tiers: ["activewear"] },
  { id: "vuori",          name: "Vuori",            host: "vuoriclothing.com",   tiers: ["activewear"] },
  { id: "outdoorvoices",  name: "Outdoor Voices",   host: "outdoorvoices.com",   tiers: ["activewear"] },
  { id: "beyondyoga",     name: "Beyond Yoga",      host: "beyondyoga.com",      tiers: ["activewear"] },

  // ───── Fast-fashion ─────
  { id: "hm",             name: "H&M",              host: "hm.com",              tiers: ["fast-fashion"] },
  { id: "zara",           name: "Zara",             host: "zara.com",            tiers: ["fast-fashion"] },
  { id: "uniqlo",         name: "Uniqlo",           host: "uniqlo.com",          tiers: ["fast-fashion"] },
  { id: "asos",           name: "ASOS",             host: "asos.com",            tiers: ["fast-fashion"] },

  // ───── Swimwear specialists ─────
  { id: "summersalt",     name: "Summersalt",       host: "summersalt.com",      tiers: ["swim", "mid"] },
  { id: "solidstriped",   name: "Solid & Striped",  host: "solidandstriped.com", tiers: ["swim", "mid"] },

  // ───── Intimates (bras, underwear, sleepwear) ─────
  { id: "barenecessities", name: "Bare Necessities", host: "barenecessities.com", tiers: ["intimates", "swim"] },
  { id: "bravissimo",     name: "Bravissimo",       host: "bravissimo.com",      tiers: ["intimates", "swim"] },
  { id: "freya",          name: "Freya",            host: "freyalingerie.com",   tiers: ["intimates", "swim"] },
  { id: "hankypanky",     name: "Hanky Panky",      host: "hankypanky.com",      tiers: ["intimates"] },

  // ───── Shoes & bags ─────
  { id: "zappos",         name: "Zappos",           host: "zappos.com",          tiers: ["shoes-bags", "mid", "designer"] },
  { id: "nisolo",         name: "Nisolo",           host: "nisolo.com",          tiers: ["shoes-bags", "mid"] },
];

const HOST_TO_ID = new Map(RETAILERS.map((r) => [r.host, r.id]));
const NAME_TO_ID = new Map(
  RETAILERS.map((r) => [r.name.toLowerCase(), r.id]),
);

// Try to map a free-form brand string Gemini hands us to a known
// retailer. Looks at exact name match, then bare-host match, then
// loose substring match against either. Returns null when there's
// no plausible mapping.
export function findRetailerByBrandHint(brand: string | null): Retailer | null {
  if (!brand) return null;
  const trimmed = brand.trim().toLowerCase();
  if (!trimmed) return null;

  const byName = NAME_TO_ID.get(trimmed);
  if (byName) return RETAILERS.find((r) => r.id === byName) ?? null;

  for (const [host, id] of HOST_TO_ID) {
    if (trimmed === host || trimmed === host.replace(/\.[a-z]+$/, "")) {
      return RETAILERS.find((r) => r.id === id) ?? null;
    }
  }
  for (const r of RETAILERS) {
    const nameMatch = trimmed.includes(r.name.toLowerCase()) ||
      r.name.toLowerCase().includes(trimmed);
    if (nameMatch) return r;
  }
  return null;
}

type SpecForPick = {
  brandHint: string | null;
  category: string | null;
  priceTier: string | null;
};

// Pick up to `count` retailers for a spec. Strategy:
//   1. If brandHint matches a known retailer, put it first (they'll
//      most likely have the exact thing the AI was thinking of).
//   2. Filter the rest by tier — activewear specs go to activewear
//      retailers, swim to swim, etc. Falls back to mid-tier when the
//      tier hint is missing or non-standard.
//   3. Bias toward broader-coverage retailers (Nordstrom, Shopbop)
//      after the brand-hint match so the user has at least one
//      "find it on a department store" link even when the spec is
//      narrow.
export function pickRetailersForSpec(
  spec: SpecForPick,
  count = 3,
): Retailer[] {
  const out: Retailer[] = [];
  const seen = new Set<string>();

  const brandMatch = findRetailerByBrandHint(spec.brandHint);
  if (brandMatch) {
    out.push(brandMatch);
    seen.add(brandMatch.id);
  }

  const tier = inferTier(spec);
  const tierPool = RETAILERS.filter(
    (r) => r.tiers.includes(tier) && !seen.has(r.id),
  );
  const broadPool = RETAILERS.filter(
    (r) => r.tiers.includes("mid") && !seen.has(r.id) && !tierPool.includes(r),
  );

  for (const r of tierPool) {
    if (out.length >= count) break;
    out.push(r);
    seen.add(r.id);
  }
  for (const r of broadPool) {
    if (out.length >= count) break;
    out.push(r);
    seen.add(r.id);
  }

  return out;
}

function inferTier(spec: SpecForPick): Tier {
  const t = (spec.priceTier ?? "").toLowerCase();
  if (t.includes("fast")) return "fast-fashion";
  if (t.includes("luxury") || t.includes("designer") || t.includes("high")) {
    return "designer";
  }

  // Fall back to category for athletic / swim / shoes / intimates specs
  // that the model didn't explicitly tier.
  const cat = (spec.category ?? "").toLowerCase();
  if (cat.includes("activewear")) return "activewear";
  if (cat.includes("swim")) return "swim";
  if (cat.includes("shoes") || cat.includes("bags")) return "shoes-bags";
  if (cat.includes("bra") || cat.includes("underwear") || cat.includes("hosiery")) {
    return "intimates";
  }

  return "mid";
}
