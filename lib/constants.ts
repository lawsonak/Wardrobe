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

