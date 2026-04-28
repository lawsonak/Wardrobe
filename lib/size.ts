// Light-touch size normalization. We don't try to be too clever — just
// fix the obvious shorthand variants so the closet displays consistently.

import type { Category } from "@/lib/constants";

const ALPHA_MAP: Record<string, string> = {
  xxs: "XXS",
  xs: "XS",
  s: "S",
  sm: "S",
  small: "Small",
  m: "M",
  med: "M",
  medium: "Medium",
  l: "L",
  lg: "L",
  large: "Large",
  xl: "XL",
  "x-large": "XL",
  "extra large": "XL",
  xxl: "XXL",
  "xxxl": "XXXL",
  "1x": "1X",
  "2x": "2X",
  "3x": "3X",
};

// "32x30" / "32 x 30" / "32X30" → "32W x 30L"
const JEANS = /^\s*(\d{2})\s*[x×]\s*(\d{2})\s*$/i;

// "34dd" / "34 DDD" → "34DD"
const BRA = /^\s*(2[8-9]|3\d|4[0-8])\s*([a-h]{1,3})\s*$/i;

export function normalizeSize(input: string, category?: Category): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  // Whole-string alpha shorthand → canonical
  const lower = raw.toLowerCase();
  if (ALPHA_MAP[lower]) return ALPHA_MAP[lower];

  // Jeans / pants
  const j = raw.match(JEANS);
  if (j) return `${j[1]}W x ${j[2]}L`;

  // Bras
  if (category === "Activewear" || /bra|sports/i.test(category ?? "")) {
    const b = raw.match(BRA);
    if (b) return `${b[1]}${b[2].toUpperCase()}`;
  }
  // Also try bra format generally if no category given
  if (!category) {
    const b = raw.match(BRA);
    if (b) return `${b[1]}${b[2].toUpperCase()}`;
  }

  // Numeric only (e.g. "8") — leave as-is.
  if (/^\d+$/.test(raw)) return raw;

  // Title-case multiword (e.g. "extra small" handled above; otherwise pass through trimmed).
  return raw;
}
