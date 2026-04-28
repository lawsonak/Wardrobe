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
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SUBTYPES_BY_CATEGORY: Record<Category, string[]> = {
  Tops: ["T-shirt", "Blouse", "Sweater", "Tank", "Cardigan", "Hoodie", "Polo"],
  Bottoms: ["Jeans", "Trousers", "Shorts", "Skirt", "Leggings", "Joggers"],
  Dresses: ["Casual dress", "Maxi dress", "Cocktail dress", "Sundress", "Wrap dress"],
  Outerwear: ["Jacket", "Coat", "Blazer", "Vest", "Trench"],
  Shoes: ["Sneakers", "Heels", "Boots", "Sandals", "Flats", "Loafers"],
  Accessories: ["Belt", "Scarf", "Hat", "Sunglasses", "Gloves", "Hair accessory"],
  Activewear: ["Sports bra", "Athletic top", "Athletic bottoms", "Athletic dress"],
  Loungewear: ["Pajama top", "Pajama bottoms", "Robe", "Loungeset"],
  Bags: ["Tote", "Crossbody", "Clutch", "Backpack", "Handbag"],
  Jewelry: [
    "Rings",
    "Earrings",
    "Necklaces",
    "Bracelets",
    "Watches",
    "Charms",
    "Brooches",
    "Anklets",
    "Formal jewelry",
    "Everyday jewelry",
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

export function getFirstName(name?: string | null, email?: string | null): string {
  if (name) return name.split(" ")[0];
  if (email) return email.split("@")[0].split(".")[0];
  return "";
}
