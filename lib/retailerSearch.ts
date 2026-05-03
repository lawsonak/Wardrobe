// Curated retailer list for the "Shop for this trip" pipeline. Replaces
// the dead Google Custom Search Engine integration — instead of trying
// to find a specific product URL, we hand the user a search-page link
// for each retailer that fits the spec's price tier and category.
//
// Why hardcode the list (and the URL templates):
//   - Search URL formats are stable per retailer but inconsistent across
//     them (?q=, ?Ntt=, ?keyword=, ?searchTerm=, etc.). Hardcoding lets
//     each retailer use its native query param.
//   - The selection of retailers itself is editorial — this is a personal
//     wardrobe app, not a marketplace, so we curate.
//   - If a retailer's search URL ever moves, fix it here in one place.

const enc = encodeURIComponent;

type Tier = "fast-fashion" | "mid" | "designer" | "activewear" | "swim" | "shoes-bags";

export type Retailer = {
  id: string;
  name: string;
  host: string;
  /** Build a search URL for the given query string. */
  searchUrl: (query: string) => string;
  /** Tiers this retailer fits. A retailer can match multiple. */
  tiers: Tier[];
};

export const RETAILERS: Retailer[] = [
  // ───── Mid-tier (broad coverage) ─────
  {
    id: "madewell",
    name: "Madewell",
    host: "madewell.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.madewell.com/search?q=${enc(q)}`,
  },
  {
    id: "jcrew",
    name: "J.Crew",
    host: "jcrew.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.jcrew.com/search?Ntt=${enc(q)}`,
  },
  {
    id: "everlane",
    name: "Everlane",
    host: "everlane.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.everlane.com/search?q=${enc(q)}`,
  },
  {
    id: "reformation",
    name: "Reformation",
    host: "thereformation.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.thereformation.com/search?q=${enc(q)}`,
  },
  {
    id: "anthropologie",
    name: "Anthropologie",
    host: "anthropologie.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.anthropologie.com/search?q=${enc(q)}`,
  },
  {
    id: "freepeople",
    name: "Free People",
    host: "freepeople.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.freepeople.com/search?q=${enc(q)}`,
  },
  {
    id: "aritzia",
    name: "Aritzia",
    host: "aritzia.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.aritzia.com/us/en/search?q=${enc(q)}`,
  },
  {
    id: "abercrombie",
    name: "Abercrombie",
    host: "abercrombie.com",
    tiers: ["mid"],
    searchUrl: (q) =>
      `https://www.abercrombie.com/shop/us/search?searchTerm=${enc(q)}`,
  },
  {
    id: "nordstrom",
    name: "Nordstrom",
    host: "nordstrom.com",
    tiers: ["mid", "designer", "shoes-bags"],
    searchUrl: (q) => `https://www.nordstrom.com/sr?keyword=${enc(q)}`,
  },
  {
    id: "boden",
    name: "Boden",
    host: "boden.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.boden.com/en-us/search?q=${enc(q)}`,
  },
  {
    id: "sezane",
    name: "Sézane",
    host: "sezane.com",
    tiers: ["mid"],
    searchUrl: (q) => `https://www.sezane.com/us/search?q=${enc(q)}`,
  },

  // ───── Designer / luxury ─────
  {
    id: "netaporter",
    name: "Net-a-Porter",
    host: "net-a-porter.com",
    tiers: ["designer"],
    searchUrl: (q) =>
      `https://www.net-a-porter.com/en-us/shop/search?keywords=${enc(q)}`,
  },
  {
    id: "ssense",
    name: "SSENSE",
    host: "ssense.com",
    tiers: ["designer"],
    searchUrl: (q) => `https://www.ssense.com/en-us/search?q=${enc(q)}`,
  },
  {
    id: "mytheresa",
    name: "Mytheresa",
    host: "mytheresa.com",
    tiers: ["designer"],
    searchUrl: (q) => `https://www.mytheresa.com/us/en/search?q=${enc(q)}`,
  },
  {
    id: "saks",
    name: "Saks Fifth Avenue",
    host: "saksfifthavenue.com",
    tiers: ["designer"],
    searchUrl: (q) => `https://www.saksfifthavenue.com/search?Ntt=${enc(q)}`,
  },
  {
    id: "neimanmarcus",
    name: "Neiman Marcus",
    host: "neimanmarcus.com",
    tiers: ["designer"],
    searchUrl: (q) => `https://www.neimanmarcus.com/s.jsp?q=${enc(q)}`,
  },
  {
    id: "shopbop",
    name: "Shopbop",
    host: "shopbop.com",
    tiers: ["designer", "mid"],
    searchUrl: (q) => `https://www.shopbop.com/actions/search?q=${enc(q)}`,
  },

  // ───── Activewear ─────
  {
    id: "lululemon",
    name: "Lululemon",
    host: "lululemon.com",
    tiers: ["activewear"],
    searchUrl: (q) => `https://shop.lululemon.com/search?Ntt=${enc(q)}`,
  },
  {
    id: "alo",
    name: "Alo Yoga",
    host: "aloyoga.com",
    tiers: ["activewear"],
    searchUrl: (q) => `https://www.aloyoga.com/search?q=${enc(q)}`,
  },
  {
    id: "vuori",
    name: "Vuori",
    host: "vuoriclothing.com",
    tiers: ["activewear"],
    searchUrl: (q) => `https://vuoriclothing.com/search?q=${enc(q)}`,
  },
  {
    id: "outdoorvoices",
    name: "Outdoor Voices",
    host: "outdoorvoices.com",
    tiers: ["activewear"],
    searchUrl: (q) => `https://www.outdoorvoices.com/search?q=${enc(q)}`,
  },
  {
    id: "beyondyoga",
    name: "Beyond Yoga",
    host: "beyondyoga.com",
    tiers: ["activewear"],
    searchUrl: (q) => `https://beyondyoga.com/search?q=${enc(q)}`,
  },

  // ───── Fast-fashion (bot-blocking doesn't matter for redirects — the
  //                    user opens these in a real browser session) ─────
  {
    id: "hm",
    name: "H&M",
    host: "hm.com",
    tiers: ["fast-fashion"],
    searchUrl: (q) =>
      `https://www2.hm.com/en_us/search-results.html?q=${enc(q)}`,
  },
  {
    id: "zara",
    name: "Zara",
    host: "zara.com",
    tiers: ["fast-fashion"],
    searchUrl: (q) =>
      `https://www.zara.com/us/en/search?searchTerm=${enc(q)}`,
  },
  {
    id: "uniqlo",
    name: "Uniqlo",
    host: "uniqlo.com",
    tiers: ["fast-fashion"],
    searchUrl: (q) => `https://www.uniqlo.com/us/en/search?q=${enc(q)}`,
  },
  {
    id: "asos",
    name: "ASOS",
    host: "asos.com",
    tiers: ["fast-fashion"],
    searchUrl: (q) => `https://www.asos.com/us/search/?q=${enc(q)}`,
  },

  // ───── Swimwear specialists ─────
  {
    id: "summersalt",
    name: "Summersalt",
    host: "summersalt.com",
    tiers: ["swim", "mid"],
    searchUrl: (q) => `https://www.summersalt.com/search?q=${enc(q)}`,
  },
  {
    id: "solidstriped",
    name: "Solid & Striped",
    host: "solidandstriped.com",
    tiers: ["swim", "mid"],
    searchUrl: (q) => `https://www.solidandstriped.com/search?q=${enc(q)}`,
  },

  // ───── Shoes & bags ─────
  {
    id: "zappos",
    name: "Zappos",
    host: "zappos.com",
    tiers: ["shoes-bags", "mid", "designer"],
    searchUrl: (q) => `https://www.zappos.com/search?term=${enc(q)}`,
  },
  {
    id: "nisolo",
    name: "Nisolo",
    host: "nisolo.com",
    tiers: ["shoes-bags", "mid"],
    searchUrl: (q) => `https://nisolo.com/search?q=${enc(q)}`,
  },
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

  // Fall back to category for athletic / swim / shoes specs that the
  // model didn't explicitly tier.
  const cat = (spec.category ?? "").toLowerCase();
  if (cat.includes("activewear")) return "activewear";
  if (cat.includes("swim")) return "swim";
  if (cat.includes("shoes") || cat.includes("bags")) return "shoes-bags";

  return "mid";
}
