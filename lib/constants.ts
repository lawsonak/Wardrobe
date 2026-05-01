export const CATEGORIES = [
  "Tops",
  "Bottoms",
  "Dresses",
  "Outerwear",
  "Shoes",
  "Accessories",
  "Activewear",
  "Loungewear",
  "Bags",
  "Jewelry",
  "Bras",
  "Underwear",
  "Swimwear",
  "Socks & Hosiery",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SUBTYPES_BY_CATEGORY: Record<Category, string[]> = {
  Tops: [
    "T-shirt",
    "Long sleeve",
    "Blouse",
    "Sweater",
    "Tank",
    "Camisole",
    "Cardigan",
    "Hoodie",
    "Sweatshirt",
    "Polo",
    "Bodysuit",
    "Crop top",
    "Tunic",
    "Button-down",
  ],
  Bottoms: [
    "Jeans",
    "Trousers",
    "Dress pants",
    "Shorts",
    "Skirt",
    "Mini skirt",
    "Midi skirt",
    "Maxi skirt",
    "Leggings",
    "Joggers",
    "Capris",
  ],
  Dresses: [
    "Casual dress",
    "Maxi dress",
    "Midi dress",
    "Mini dress",
    "Cocktail dress",
    "Sundress",
    "Wrap dress",
    "Slip dress",
    "Shirt dress",
    "Sweater dress",
    "Formal gown",
    "Jumpsuit",
    "Romper",
  ],
  Outerwear: [
    "Jacket",
    "Denim jacket",
    "Leather jacket",
    "Coat",
    "Trench",
    "Puffer",
    "Parka",
    "Blazer",
    "Vest",
    "Cardigan coat",
    "Poncho",
    "Cape",
  ],
  Shoes: [
    "Sneakers",
    "Heels",
    "Pumps",
    "Boots",
    "Ankle boots",
    "Knee boots",
    "Sandals",
    "Flip-flops",
    "Flats",
    "Loafers",
    "Mules",
    "Wedges",
    "Slippers",
  ],
  Accessories: [
    "Belt",
    "Scarf",
    "Hat",
    "Beanie",
    "Sunglasses",
    "Gloves",
    "Hair accessory",
    "Tie",
    "Pocket square",
    "Wallet",
  ],
  Activewear: [
    "Sports bra",
    "Athletic top",
    "Athletic bottoms",
    "Athletic dress",
    "Workout shorts",
    "Yoga pants",
    "Track jacket",
    "Tennis skirt",
  ],
  Loungewear: [
    "Pajama top",
    "Pajama bottoms",
    "Pajama set",
    "Robe",
    "Loungeset",
    "Nightgown",
    "Sleep shirt",
    "Sleep shorts",
  ],
  Bags: [
    "Tote",
    "Crossbody",
    "Clutch",
    "Backpack",
    "Handbag",
    "Shoulder bag",
    "Bucket bag",
    "Mini bag",
    "Weekender",
    "Belt bag",
  ],
  Jewelry: [
    "Rings",
    "Earrings",
    "Studs",
    "Hoops",
    "Necklaces",
    "Pendants",
    "Bracelets",
    "Bangles",
    "Watches",
    "Charms",
    "Brooches",
    "Anklets",
    "Formal jewelry",
    "Everyday jewelry",
  ],
  Bras: [
    "T-shirt bra",
    "Push-up",
    "Plunge",
    "Balconette",
    "Wireless",
    "Bralette",
    "Strapless",
    "Convertible",
    "Sports bra",
    "Nursing",
    "Lace bra",
    "Longline",
  ],
  Underwear: [
    "Briefs",
    "Bikini",
    "Hipster",
    "Boyshort",
    "Thong",
    "G-string",
    "High-waisted",
    "Seamless",
    "Lace",
    "Cheeky",
    "Shapewear",
  ],
  Swimwear: [
    "One-piece",
    "Bikini top",
    "Bikini bottom",
    "Tankini",
    "Cover-up",
    "Rash guard",
    "Swim shorts",
    "Swim dress",
  ],
  "Socks & Hosiery": [
    "Ankle socks",
    "Crew socks",
    "Knee-high socks",
    "Tights",
    "Stockings",
    "Pantyhose",
    "Trouser socks",
    "Athletic socks",
  ],
};

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const ACTIVITIES = [
  "casual",
  "work",
  "date",
  "workout",
  "beach",
  "formal",
  "travel",
  "lounge",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const SLOTS = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "bag",
] as const;
export type Slot = (typeof SLOTS)[number];

export const CATEGORY_TO_SLOT: Record<Category, Slot> = {
  Tops: "top",
  Bottoms: "bottom",
  Dresses: "dress",
  Outerwear: "outerwear",
  Shoes: "shoes",
  Accessories: "accessory",
  Activewear: "top",
  Loungewear: "top",
  Bags: "bag",
  Jewelry: "accessory",
  Bras: "top",
  Underwear: "bottom",
  Swimwear: "top",
  "Socks & Hosiery": "shoes",
};

// Sub-type overrides for slot resolution. SUBTYPE_TO_SLOT wins over
// CATEGORY_TO_SLOT, so a "Leggings" item lands in the bottom slot even
// if AI mis-tagged it as Activewear (which defaults to "top"), and an
// "Earrings" item lands in accessory even if it ended up as Tops.
//
// We map *every* common subType across SUBTYPES_BY_CATEGORY so a wrong
// category doesn't silently put items in the wrong section of the
// outfit builder. Tops / Bras / Sports bra etc. don't need entries
// because "top" is already the safe default for anything unmapped.
export const SUBTYPE_TO_SLOT: Record<string, Slot> = {
  // ── Bottoms ──────────────────────────────────────────────────
  // Many of these end up tagged as Activewear / Loungewear by AI,
  // and were silently bucketed as "top" before this mapping.
  "Jeans": "bottom",
  "Trousers": "bottom",
  "Dress pants": "bottom",
  "Shorts": "bottom",
  "Skirt": "bottom",
  "Mini skirt": "bottom",
  "Midi skirt": "bottom",
  "Maxi skirt": "bottom",
  "Leggings": "bottom",
  "Joggers": "bottom",
  "Capris": "bottom",

  // ── Dresses ──────────────────────────────────────────────────
  "Casual dress": "dress",
  "Maxi dress": "dress",
  "Midi dress": "dress",
  "Mini dress": "dress",
  "Cocktail dress": "dress",
  "Sundress": "dress",
  "Wrap dress": "dress",
  "Slip dress": "dress",
  "Shirt dress": "dress",
  "Sweater dress": "dress",
  "Formal gown": "dress",
  "Jumpsuit": "dress",
  "Romper": "dress",

  // ── Outerwear ────────────────────────────────────────────────
  // Cardigan stays a Top intentionally — it's worn as one most of the
  // time. "Cardigan coat" is the heavier outerwear variant.
  "Jacket": "outerwear",
  "Denim jacket": "outerwear",
  "Leather jacket": "outerwear",
  "Coat": "outerwear",
  "Trench": "outerwear",
  "Puffer": "outerwear",
  "Parka": "outerwear",
  "Blazer": "outerwear",
  "Vest": "outerwear",
  "Cardigan coat": "outerwear",
  "Poncho": "outerwear",
  "Cape": "outerwear",

  // ── Shoes ────────────────────────────────────────────────────
  "Sneakers": "shoes",
  "Heels": "shoes",
  "Pumps": "shoes",
  "Boots": "shoes",
  "Ankle boots": "shoes",
  "Knee boots": "shoes",
  "Sandals": "shoes",
  "Flip-flops": "shoes",
  "Flats": "shoes",
  "Loafers": "shoes",
  "Mules": "shoes",
  "Wedges": "shoes",
  "Slippers": "shoes",

  // ── Accessories ──────────────────────────────────────────────
  "Belt": "accessory",
  "Scarf": "accessory",
  "Hat": "accessory",
  "Beanie": "accessory",
  "Sunglasses": "accessory",
  "Gloves": "accessory",
  "Hair accessory": "accessory",
  "Tie": "accessory",
  "Pocket square": "accessory",
  "Wallet": "accessory",

  // ── Jewelry ──────────────────────────────────────────────────
  "Rings": "accessory",
  "Earrings": "accessory",
  "Studs": "accessory",
  "Hoops": "accessory",
  "Necklaces": "accessory",
  "Pendants": "accessory",
  "Bracelets": "accessory",
  "Bangles": "accessory",
  "Watches": "accessory",
  "Charms": "accessory",
  "Brooches": "accessory",
  "Anklets": "accessory",
  "Formal jewelry": "accessory",
  "Everyday jewelry": "accessory",

  // ── Bags ─────────────────────────────────────────────────────
  "Tote": "bag",
  "Crossbody": "bag",
  "Clutch": "bag",
  "Backpack": "bag",
  "Handbag": "bag",
  "Shoulder bag": "bag",
  "Bucket bag": "bag",
  "Mini bag": "bag",
  "Weekender": "bag",
  "Belt bag": "bag",

  // ── Swimwear ─────────────────────────────────────────────────
  // One-pieces / swim dresses live in the Top slot rather than Dress
  // so they don't get conflated with regular dresses in the picker.
  // The builder still treats Swimwear as its own category — see the
  // "no underwear with swimsuits" / "swim only on beach" rules in
  // the AI prompt and `surprise()` fallback.
  "Bikini bottom": "bottom",
  "Swim shorts": "bottom",
  "One-piece": "top",
  "Swim dress": "top",
  "Cover-up": "outerwear",
  "Tankini": "top",
  "Bikini top": "top",
  "Rash guard": "top",

  // ── Activewear ───────────────────────────────────────────────
  "Athletic bottoms": "bottom",
  "Workout shorts": "bottom",
  "Yoga pants": "bottom",
  "Tennis skirt": "bottom",
  "Athletic dress": "dress",
  "Track jacket": "outerwear",

  // ── Loungewear ───────────────────────────────────────────────
  "Pajama bottoms": "bottom",
  "Sleep shorts": "bottom",
  "Robe": "outerwear",
  "Nightgown": "dress",
  "Pajama set": "dress", // a one-piece pajama set covers full body
};

// Resolve the right slot for an item using its subType when an
// override exists; falls back to the category-level default.
export function slotForItem(
  category: string | null | undefined,
  subType: string | null | undefined,
): Slot {
  if (subType && SUBTYPE_TO_SLOT[subType]) return SUBTYPE_TO_SLOT[subType];
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    return CATEGORY_TO_SLOT[category as Category];
  }
  return "accessory";
}

export const COLOR_PALETTE = [
  { name: "white", hex: "#ffffff" },
  { name: "cream", hex: "#f8f1e7" },
  { name: "beige", hex: "#d6c4a8" },
  { name: "tan", hex: "#b08866" },
  { name: "brown", hex: "#6e4a2a" },
  { name: "black", hex: "#1a1a1a" },
  { name: "gray", hex: "#9aa0a6" },
  { name: "navy", hex: "#1f2a4a" },
  { name: "blue", hex: "#4a7bc8" },
  { name: "teal", hex: "#2f8f8a" },
  { name: "green", hex: "#4f8b4a" },
  { name: "olive", hex: "#7a8049" },
  { name: "yellow", hex: "#f0c43a" },
  { name: "orange", hex: "#e08a3c" },
  { name: "red", hex: "#c2424a" },
  { name: "burgundy", hex: "#7a1f2e" },
  { name: "pink", hex: "#f4a8c0" },
  { name: "blush", hex: "#f7d6df" },
  { name: "purple", hex: "#7d5cb5" },
  { name: "lavender", hex: "#c8b6e0" },
  { name: "gold", hex: "#d4a843" },
  { name: "silver", hex: "#b0b8c1" },
  { name: "multi", hex: "linear-gradient(135deg,#f4a8c0,#c8b6e0,#4a7bc8)" },
] as const;

export const ITEM_STATUSES = ["active", "needs_review", "draft"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const WISHLIST_PRIORITIES = ["low", "medium", "high"] as const;
export type WishlistPriority = (typeof WISHLIST_PRIORITIES)[number];

export function csvToList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listToCsv(values: string[] | undefined): string {
  if (!values) return "";
  return values.filter(Boolean).join(",");
}

