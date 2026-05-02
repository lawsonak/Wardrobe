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
    "Bike shorts",
    "Yoga pants",
    "Leggings",
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
  "Bike shorts": "bottom",
  "Biker shorts": "bottom",
  "Yoga pants": "bottom",
  "Sweatpants": "bottom",
  "Track pants": "bottom",
  "Running shorts": "bottom",
  "Athletic skirt": "bottom",
  "Tennis skirt": "bottom",
  "Athletic dress": "dress",
  "Tennis dress": "dress",
  "Track jacket": "outerwear",
  "Windbreaker": "outerwear",
  "Athletic jacket": "outerwear",

  // ── Loungewear ───────────────────────────────────────────────
  "Pajama bottoms": "bottom",
  "Pajama pants": "bottom",
  "Sleep shorts": "bottom",
  "Robe": "outerwear",
  "Nightgown": "dress",
  "Pajama set": "dress", // a one-piece pajama set covers full body
  "Loungewear set": "dress",

  // ── Underwear (the explicit "stay out of normal outfit slots"
  //    category, but the slot still has to be sensible if surfaced)
  "Briefs": "bottom",
  "Hipster": "bottom",
  "Boyshort": "bottom",
  "Thong": "bottom",
  "G-string": "bottom",
  "High-waisted": "bottom",
  "Cheeky": "bottom",
  "Bikini": "bottom",
  "Shapewear": "bottom",

  // ── Extra Bottoms variations the AI commonly emits ───────────
  "Pants": "bottom",
  "Slacks": "bottom",
  "Chinos": "bottom",
  "Khakis": "bottom",
  "Cargo pants": "bottom",
  "Wide-leg pants": "bottom",
  "Straight-leg pants": "bottom",
  "Cropped pants": "bottom",
  "Culottes": "bottom",
  "Palazzo pants": "bottom",
  "Skort": "bottom",

  // ── Extra Outerwear variations ───────────────────────────────
  "Bomber jacket": "outerwear",
  "Bomber": "outerwear",
  "Peacoat": "outerwear",
  "Pea coat": "outerwear",
  "Overcoat": "outerwear",
  "Raincoat": "outerwear",
  "Anorak": "outerwear",
  "Shacket": "outerwear",
  "Shirt jacket": "outerwear",
  "Suit jacket": "outerwear",
  "Sport coat": "outerwear",
  "Kimono": "outerwear",
  "Wrap": "outerwear",

  // ── Extra Shoes variations ───────────────────────────────────
  "Stilettos": "shoes",
  "Combat boots": "shoes",
  "Cowboy boots": "shoes",
  "Hiking boots": "shoes",
  "Rain boots": "shoes",
  "Espadrilles": "shoes",
  "Slides": "shoes",
  "Trainers": "shoes",
  "Athletic shoes": "shoes",
  "Running shoes": "shoes",
  "Tennis shoes": "shoes",
  "Clogs": "shoes",
  "Oxfords": "shoes",
  "Brogues": "shoes",
  "Ballet flats": "shoes",

  // ── Extra Bags variations ────────────────────────────────────
  "Purse": "bag",
  "Hobo bag": "bag",
  "Satchel": "bag",
  "Duffel": "bag",
  "Duffel bag": "bag",
  "Messenger bag": "bag",

  // ── Extra Accessories variations ─────────────────────────────
  "Cap": "accessory",
  "Baseball cap": "accessory",
  "Bucket hat": "accessory",
  "Fedora": "accessory",
  "Sun hat": "accessory",
  "Headband": "accessory",
  "Hair clip": "accessory",
  "Bandana": "accessory",
  "Glasses": "accessory",
  "Eyeglasses": "accessory",
  "Goggles": "accessory",
};

// Keyword fallback for slot resolution. When the AI emits a compound
// subtype that isn't in SUBTYPE_TO_SLOT verbatim ("tunic dress",
// "athletic skirt", "running shoes", "jersey romper"), this list
// catches the dominant word and routes to the right slot.
//
// Order matters: the FIRST keyword that appears anywhere in the
// (lowercased) subtype wins. So "dress" / "gown" / "jumpsuit" come
// before "shirt" so that "shirt dress" classifies as a dress, not
// a top. Word-boundary regex match avoids false positives like
// "stress" → "ress" → "dress".
//
// "Top"-leaning keywords land at the very end since most Tops just
// fall through to the category-default "top" anyway — we only need
// to catch the cases where the category itself is wrong (e.g. AI
// tagged Activewear+T-shirt which would otherwise default to "top"
// correctly, but Activewear+leggings would default to "top" wrong
// without the SUBTYPE_TO_SLOT entry).
const KEYWORD_TO_SLOT: ReadonlyArray<[string, Slot]> = [
  // Full-length pieces — highest priority so "shirt dress" resolves
  // to dress, not top.
  ["dress", "dress"],
  ["gown", "dress"],
  ["jumpsuit", "dress"],
  ["romper", "dress"],
  ["overalls", "dress"],

  // Outerwear — checked before "shirt"/anything top-ish.
  ["coat", "outerwear"],
  ["blazer", "outerwear"],
  ["jacket", "outerwear"],
  ["bomber", "outerwear"],
  ["parka", "outerwear"],
  ["puffer", "outerwear"],
  ["trench", "outerwear"],
  ["windbreaker", "outerwear"],
  ["raincoat", "outerwear"],
  ["shacket", "outerwear"],
  ["poncho", "outerwear"],
  ["cape", "outerwear"],
  ["kimono", "outerwear"],
  ["robe", "outerwear"],

  // Bottoms
  ["jeans", "bottom"],
  ["pants", "bottom"],
  ["trousers", "bottom"],
  ["skirt", "bottom"],
  ["shorts", "bottom"],
  ["leggings", "bottom"],
  ["joggers", "bottom"],
  ["chinos", "bottom"],
  ["khakis", "bottom"],
  ["slacks", "bottom"],
  ["sweatpants", "bottom"],
  ["culottes", "bottom"],
  ["palazzo", "bottom"],
  ["capris", "bottom"],
  ["capri", "bottom"],
  ["thong", "bottom"],
  ["briefs", "bottom"],

  // Shoes (singular and plural — the regex uses word boundaries)
  ["sneaker", "shoes"],
  ["sneakers", "shoes"],
  ["trainer", "shoes"],
  ["trainers", "shoes"],
  ["boot", "shoes"],
  ["boots", "shoes"],
  ["sandal", "shoes"],
  ["sandals", "shoes"],
  ["heel", "shoes"],
  ["heels", "shoes"],
  ["loafer", "shoes"],
  ["loafers", "shoes"],
  ["mule", "shoes"],
  ["mules", "shoes"],
  ["flats", "shoes"],
  ["wedge", "shoes"],
  ["wedges", "shoes"],
  ["slipper", "shoes"],
  ["slippers", "shoes"],
  ["clog", "shoes"],
  ["clogs", "shoes"],
  ["oxford", "shoes"],
  ["oxfords", "shoes"],
  ["pump", "shoes"],
  ["pumps", "shoes"],
  ["espadrille", "shoes"],
  ["espadrilles", "shoes"],
  ["slides", "shoes"],

  // Bags
  ["tote", "bag"],
  ["purse", "bag"],
  ["clutch", "bag"],
  ["backpack", "bag"],
  ["satchel", "bag"],
  ["duffel", "bag"],
  ["crossbody", "bag"],
  ["handbag", "bag"],
  ["weekender", "bag"],

  // Accessories — earring before ring (substring concern); hat
  // before cap so "baseball cap" still matches cap.
  ["earring", "accessory"],
  ["earrings", "accessory"],
  ["necklace", "accessory"],
  ["bracelet", "accessory"],
  ["bangle", "accessory"],
  ["watch", "accessory"],
  ["beanie", "accessory"],
  ["fedora", "accessory"],
  ["headband", "accessory"],
  ["scarf", "accessory"],
  ["belt", "accessory"],
  ["sunglasses", "accessory"],
  ["glove", "accessory"],
  ["wallet", "accessory"],
  ["bandana", "accessory"],
  ["hat", "accessory"],
  ["cap", "accessory"],

  // Tops — bottom of the list. Most tops resolve via category
  // default; these only matter when the category itself is wrong.
  ["t-shirt", "top"],
  ["tank", "top"],
  ["blouse", "top"],
  ["sweater", "top"],
  ["hoodie", "top"],
  ["sweatshirt", "top"],
  ["polo", "top"],
  ["bodysuit", "top"],
  ["camisole", "top"],
  ["halter", "top"],
  ["tunic", "top"],
  ["bra", "top"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordSlotForSubtype(subTypeLower: string): Slot | null {
  for (const [keyword, slot] of KEYWORD_TO_SLOT) {
    const re = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    if (re.test(subTypeLower)) return slot;
  }
  return null;
}

// Lowercase index of SUBTYPE_TO_SLOT so the lookup tolerates whatever
// casing the AI tagger or a user types ("leggings", "Leggings",
// "LEGGINGS" all resolve the same). Built once at module load.
const SUBTYPE_TO_SLOT_LOWER: Record<string, Slot> = (() => {
  const out: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(SUBTYPE_TO_SLOT)) {
    out[k.toLowerCase()] = v;
  }
  return out;
})();

// Resolve the right slot for an item, in order of confidence:
//   1. Exact match against SUBTYPE_TO_SLOT (case-insensitive, trim)
//      — handles every enumerated subtype directly.
//   2. Word-boundary keyword match against KEYWORD_TO_SLOT — catches
//      compound subtypes the AI invents that aren't in the table
//      ("tunic dress" → dress, "athletic skirt" → bottom, "running
//      shoes" → shoes, "shirt jacket" → outerwear).
//   3. Category-level default — the safe fallback when both the
//      exact and keyword passes miss.
//   4. "accessory" as the last-resort when even the category is bogus.
export function slotForItem(
  category: string | null | undefined,
  subType: string | null | undefined,
): Slot {
  const key = subType?.trim().toLowerCase();
  if (key) {
    const exact = SUBTYPE_TO_SLOT_LOWER[key];
    if (exact) return exact;
    const fuzzy = keywordSlotForSubtype(key);
    if (fuzzy) return fuzzy;
  }
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    return CATEGORY_TO_SLOT[category as Category];
  }
  return "accessory";
}

// 33 named colors + a "multi" gradient sentinel for prints. Tuned for
// AI tagging: the previous 22-color palette forced the model to map
// shades like dusty rose, sage, charcoal, and rust onto the nearest
// blunt color (e.g. "pink" for mauve, "gray" for charcoal), which lost
// useful detail in outfit suggestions and search filters. The added
// shades fill the most common gaps without exploding the swatch grid.
//
// Order is roughly visual-family grouped: neutrals → warm earth →
// dark/cool neutrals → blues → greens → yellows/warm brights → reds →
// pinks/purples → metallic + multi.
export const COLOR_PALETTE = [
  // Light neutrals
  { name: "white", hex: "#ffffff" },
  { name: "cream", hex: "#f8f1e7" },
  // Warm earth
  { name: "beige", hex: "#d6c4a8" },
  { name: "khaki", hex: "#a8a47a" },
  { name: "tan", hex: "#b08866" },
  { name: "rust", hex: "#a44b2a" },
  { name: "brown", hex: "#6e4a2a" },
  // Dark / cool neutrals
  { name: "black", hex: "#1a1a1a" },
  { name: "charcoal", hex: "#3a3f47" },
  { name: "gray", hex: "#9aa0a6" },
  { name: "light gray", hex: "#cfd5db" },
  { name: "silver", hex: "#b0b8c1" },
  // Blues
  { name: "navy", hex: "#1f2a4a" },
  { name: "royal blue", hex: "#1e4cb5" },
  { name: "blue", hex: "#4a7bc8" },
  { name: "sky blue", hex: "#a8c8e6" },
  { name: "teal", hex: "#2f8f8a" },
  // Greens
  { name: "forest", hex: "#2d5a3a" },
  { name: "green", hex: "#4f8b4a" },
  { name: "olive", hex: "#7a8049" },
  { name: "mint", hex: "#9ed8b6" },
  // Yellows / warm brights
  { name: "mustard", hex: "#d4a73a" },
  { name: "yellow", hex: "#f0c43a" },
  { name: "orange", hex: "#e08a3c" },
  { name: "coral", hex: "#e87a6f" },
  // Reds
  { name: "red", hex: "#c2424a" },
  { name: "burgundy", hex: "#7a1f2e" },
  // Pinks / purples
  { name: "pink", hex: "#f4a8c0" },
  { name: "blush", hex: "#f7d6df" },
  { name: "mauve", hex: "#b886a2" },
  { name: "purple", hex: "#7d5cb5" },
  { name: "lavender", hex: "#c8b6e0" },
  // Metallic + special
  { name: "gold", hex: "#d4a843" },
  { name: "multi", hex: "linear-gradient(135deg,#f4a8c0,#c8b6e0,#4a7bc8)" },
] as const;

// All color names from the palette, used as the AI tagger's enum so
// the model can only pick names that actually exist in the swatch.
// Derived to keep the two lists from drifting.
export const COLOR_NAMES = COLOR_PALETTE.map((c) => c.name);

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

