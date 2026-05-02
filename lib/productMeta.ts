// Direct server-side product page fetcher + Open Graph / JSON-LD
// Product schema parser. Most retailers (Madewell, J.Crew, Nordstrom,
// Zara, Reformation, …) embed structured product metadata in their
// HTML; pulling that without asking an AI to "visit the URL" is
// faster, cheaper, and avoids the hallucination footgun where Gemini's
// grounded search pivots to a different product when it can't reach
// the page.
//
// Failure modes we expect:
//   - Site blocks bots regardless of headers (Amazon, some Cloudflare
//     setups). We detect known robot-check / CAPTCHA pages and return
//     an error so the caller can fall back gracefully.
//   - Site doesn't embed any structured metadata. We return a "no
//     useful data" error rather than guessing.
//   - Network failure / timeout. Same.
//
// SSRF guard: refuse loopback / private-IP-ish hostnames so a user
// can't accidentally aim the server at its own admin routes. This is
// belt-and-suspenders for a single-user personal app, not a complete
// RFC 1918 audit.

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
    "image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export type ProductMeta = {
  name?: string;
  brand?: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  productUrl?: string;
  /** Hostname of the page we fetched, lowercase. */
  source?: string;
};

export type ProductMetaResult =
  | { ok: true; meta: ProductMeta; debug: ProductMetaDebug }
  | { ok: false; error: string; debug: ProductMetaDebug };

export type ProductMetaDebug = {
  source: string;
  status?: number;
  reason?: string;
  usedJsonLd?: boolean;
  usedOg?: boolean;
};

const PRIVATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

export async function fetchProductMeta(url: string): Promise<ProductMetaResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL", debug: { source: "n/a", reason: "bad URL" } };
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host) || host.startsWith("192.168.") || host.startsWith("10.")) {
    return { ok: false, error: "Refusing to fetch a private-network URL", debug: { source: host, reason: "private host" } };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http(s) URLs are supported", debug: { source: host, reason: `protocol ${parsed.protocol}` } };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: ctrl.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Couldn't reach ${host}`, debug: { source: host, reason } };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return {
      ok: false,
      error: `${host} returned HTTP ${res.status}`,
      debug: { source: host, status: res.status, reason: `HTTP ${res.status}` },
    };
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("html")) {
    return {
      ok: false,
      error: "Not an HTML page",
      debug: { source: host, status: res.status, reason: `content-type: ${ct || "unknown"}` },
    };
  }

  // Cap the body read so a hostile / huge page can't OOM the process.
  const html = await readBoundedText(res, MAX_HTML_BYTES);
  if (!html) {
    return { ok: false, error: "Empty response", debug: { source: host, status: res.status, reason: "no body" } };
  }

  if (looksLikeBlockedPage(html)) {
    return {
      ok: false,
      error: `${host} blocked the request (looks like a robot-check or CAPTCHA page)`,
      debug: { source: host, status: res.status, reason: "blocked page" },
    };
  }

  const ldMeta = parseJsonLdProduct(html);
  const ogMeta = parseOpenGraph(html);

  // JSON-LD is the more structured signal; prefer its values, fall back
  // to OG. og:site_name is a poor brand signal (returns "Madewell" but
  // also "Nordstrom" for a third-party brand sold on Nordstrom's site),
  // so only use it if JSON-LD didn't supply one.
  const meta: ProductMeta = {
    name: ldMeta.name ?? ogMeta.name,
    brand: ldMeta.brand ?? ogMeta.brand,
    description: ldMeta.description ?? ogMeta.description,
    price: ldMeta.price ?? ogMeta.price,
    imageUrl: ldMeta.imageUrl ?? ogMeta.imageUrl,
    productUrl: ldMeta.productUrl ?? ogMeta.productUrl ?? url,
    source: host,
  };

  const useful = [meta.name, meta.brand, meta.price, meta.description].filter(Boolean).length;
  if (useful === 0) {
    return {
      ok: false,
      error: `${host} didn't expose product metadata`,
      debug: { source: host, status: res.status, reason: "no og/json-ld" },
    };
  }

  return {
    ok: true,
    meta,
    debug: {
      source: host,
      status: res.status,
      usedJsonLd: !!(ldMeta.name || ldMeta.brand || ldMeta.price),
      usedOg: !!(ogMeta.name || ogMeta.brand || ogMeta.price),
    },
  };
}

async function readBoundedText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < max) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
  }
  // Best-effort cancel of the underlying stream once we've hit the cap.
  if (total >= max) {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function looksLikeBlockedPage(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  if (/<title>[^<]*robot check[^<]*<\/title>/i.test(html)) return true;
  if (head.includes("automated access to amazon")) return true;
  if (/<title>[^<]*(?:captcha|access denied)[^<]*<\/title>/i.test(html)) return true;
  if (head.includes("attention required") && head.includes("cloudflare")) return true;
  if (head.includes("cf-chl-bypass") || head.includes("__cf_chl_")) return true;
  return false;
}

function parseOpenGraph(html: string): ProductMeta {
  const tags = extractMetaTags(html);
  const out: ProductMeta = {};
  if (tags["og:title"]) out.name = decodeHtml(tags["og:title"]);
  if (tags["og:site_name"]) out.brand = decodeHtml(tags["og:site_name"]);
  if (tags["og:description"]) out.description = decodeHtml(tags["og:description"]).slice(0, 600);
  if (tags["og:image"]) out.imageUrl = tags["og:image"];
  if (tags["og:url"]) out.productUrl = tags["og:url"];
  const amount = tags["product:price:amount"] || tags["og:price:amount"];
  const currency = tags["product:price:currency"] || tags["og:price:currency"] || "USD";
  if (amount) out.price = formatPrice(amount, currency);
  if (!out.description && tags["description"]) out.description = decodeHtml(tags["description"]).slice(0, 600);
  return out;
}

// Pull all <meta property|name="..." content="..."> tags into a flat
// map. Tolerates either attribute order. Lowercases the keys.
function extractMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Case 1: property/name first, content second
  const a = /<meta\b[^>]*?(?:property|name)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = a.exec(html)) !== null) {
    const k = m[1].toLowerCase();
    if (!out[k]) out[k] = m[2];
  }
  // Case 2: content first, property/name second
  const b = /<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']([^"']+)["'][^>]*>/gi;
  while ((m = b.exec(html)) !== null) {
    const k = m[2].toLowerCase();
    if (!out[k]) out[k] = m[1];
  }
  return out;
}

function parseJsonLdProduct(html: string): ProductMeta {
  const out: ProductMeta = {};
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const products = collectProducts(data);
    if (products.length === 0) continue;
    const p = products[0];
    if (typeof p.name === "string") out.name = decodeHtml(p.name);
    if (typeof p.description === "string") out.description = decodeHtml(p.description).slice(0, 600);
    if (typeof p.url === "string") out.productUrl = p.url;
    const img = p.image;
    if (typeof img === "string") out.imageUrl = img;
    else if (Array.isArray(img) && typeof img[0] === "string") out.imageUrl = img[0];
    if (p.brand) {
      if (typeof p.brand === "string") out.brand = decodeHtml(p.brand);
      else if (typeof p.brand === "object" && p.brand !== null) {
        const bn = (p.brand as Record<string, unknown>).name;
        if (typeof bn === "string") out.brand = decodeHtml(bn);
      }
    }
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    if (offer && typeof offer === "object") {
      const o = offer as Record<string, unknown>;
      const price = (o.price as string | number | undefined) ??
        (typeof o.priceSpecification === "object" && o.priceSpecification !== null
          ? (o.priceSpecification as Record<string, unknown>).price as string | number | undefined
          : undefined);
      const currency = (o.priceCurrency as string | undefined) ??
        (typeof o.priceSpecification === "object" && o.priceSpecification !== null
          ? (o.priceSpecification as Record<string, unknown>).priceCurrency as string | undefined
          : undefined) ?? "USD";
      if (price != null) out.price = formatPrice(String(price), currency);
    }
    return out;
  }
  return out;
}

// Walk a JSON-LD value (which can be an object, an array, or an
// @graph-keyed object) and collect every node whose @type is "Product".
function collectProducts(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
      out.push(obj);
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  }
  if (Array.isArray(data)) data.forEach(visit);
  else visit(data);
  return out;
}

function formatPrice(amount: string, currency: string): string {
  const n = String(amount).trim();
  const c = (currency || "USD").toUpperCase();
  if (c === "USD") return `$${n}`;
  return `${n} ${c}`;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}
