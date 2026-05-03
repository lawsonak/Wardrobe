// Google Programmable Search ("Custom Search JSON API") wrapper. Used
// by the collection-shop pipeline to convert a Gemini-generated product
// SPEC ("white linen blazer Madewell, around $200") into a list of
// CURRENT product URLs from the real Google index — sidestepping the
// stale-URL hallucinations grounded search hands back from training-
// cutoff data.
//
// Setup (one-time, see CLAUDE.md):
//   1. Create a Programmable Search Engine at programmablesearchengine.google.com
//      configured with the fashion retailer domains you trust
//      (madewell.com, jcrew.com, reformation.com, …).
//   2. Copy the Search engine ID into GOOGLE_CSE_ID.
//   3. Enable Custom Search API on Google Cloud, generate an API key,
//      drop it in GOOGLE_CSE_API_KEY.
//
// Free tier: 100 queries/day, then $5 per 1000 queries.

const ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const FETCH_TIMEOUT_MS = 8000;

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  /** Hostname of the result, e.g. "madewell.com". */
  displayLink: string;
  /** og:image / pagemap thumbnail when CSE found one. May be missing. */
  thumbnailUrl: string | null;
};

export type SearchResult =
  | { ok: true; hits: SearchHit[]; debug: { totalResults: string | null; query: string } }
  | { ok: false; error: string; debug: { reason: string; query: string; status?: number } };

export function isCSEConfigured(): boolean {
  return !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID);
}

export async function searchProducts(
  query: string,
  options: { num?: number; siteRestrict?: string } = {},
): Promise<SearchResult> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) {
    return {
      ok: false,
      error: "Google CSE not configured (set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID).",
      debug: { reason: "not configured", query },
    };
  }

  const cleaned = query.trim();
  if (!cleaned) {
    return { ok: false, error: "Empty query", debug: { reason: "empty query", query } };
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", cleaned);
  url.searchParams.set("num", String(Math.max(1, Math.min(10, options.num ?? 3))));
  // Strongly prefer English-language pages to keep prices/sizing usable
  // for a US-based personal app. Users can broaden via the engine config.
  url.searchParams.set("lr", "lang_en");
  url.searchParams.set("safe", "active");
  if (options.siteRestrict) {
    url.searchParams.set("siteSearch", options.siteRestrict);
    url.searchParams.set("siteSearchFilter", "i"); // "i" = include only this domain
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Couldn't reach Google CSE`, debug: { reason, query: cleaned } };
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(text) as { error?: { message?: string } };
      if (err.error?.message) detail = err.error.message;
    } catch {
      detail = text.slice(0, 200) || detail;
    }
    return {
      ok: false,
      error: detail,
      debug: { reason: detail, query: cleaned, status: res.status },
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    items?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
      displayLink?: string;
      pagemap?: {
        cse_thumbnail?: Array<{ src?: string }>;
        cse_image?: Array<{ src?: string }>;
        metatags?: Array<Record<string, string>>;
      };
    }>;
    searchInformation?: { totalResults?: string };
  };

  const hits: SearchHit[] = (data.items ?? [])
    .map((it) => {
      const link = typeof it.link === "string" ? it.link : "";
      if (!/^https?:\/\//i.test(link)) return null;
      const ogImg =
        it.pagemap?.metatags?.[0]?.["og:image"] ??
        it.pagemap?.cse_image?.[0]?.src ??
        it.pagemap?.cse_thumbnail?.[0]?.src ??
        null;
      return {
        url: link,
        title: typeof it.title === "string" ? it.title : "",
        snippet: typeof it.snippet === "string" ? it.snippet : "",
        displayLink:
          typeof it.displayLink === "string" ? it.displayLink.toLowerCase() : "",
        thumbnailUrl:
          typeof ogImg === "string" && /^https?:\/\//i.test(ogImg) ? ogImg : null,
      };
    })
    .filter((h): h is SearchHit => h !== null);

  return {
    ok: true,
    hits,
    debug: { totalResults: data.searchInformation?.totalResults ?? null, query: cleaned },
  };
}
