import type { Category } from "@/lib/constants";

// Per-category fit-detail field templates. Each field is a key + label +
// optional unit suggestion. The editor stores them as a flat
// Record<string, string> JSON blob in Item.fitDetails so we can extend
// without DB migrations.

export type FitField = { key: string; label: string; unit?: string };

export const FIT_FIELDS: Partial<Record<Category, FitField[]>> = {
  Tops: [
    { key: "bust", label: "Bust", unit: "in" },
    { key: "waist", label: "Waist", unit: "in" },
    { key: "length", label: "Length", unit: "in" },
    { key: "sleeve", label: "Sleeve length", unit: "in" },
  ],
  Bottoms: [
    { key: "waist", label: "Waist", unit: "in" },
    { key: "hip", label: "Hip", unit: "in" },
    { key: "inseam", label: "Inseam", unit: "in" },
    { key: "rise", label: "Rise", unit: "in" },
    { key: "cut", label: "Cut" },
    { key: "stretch", label: "Stretch / fit notes" },
  ],
  Dresses: [
    { key: "bust", label: "Bust", unit: "in" },
    { key: "waist", label: "Waist", unit: "in" },
    { key: "hip", label: "Hip", unit: "in" },
    { key: "length", label: "Length", unit: "in" },
  ],
  Outerwear: [
    { key: "bust", label: "Bust", unit: "in" },
    { key: "length", label: "Length", unit: "in" },
    { key: "sleeve", label: "Sleeve length", unit: "in" },
  ],
  Shoes: [
    { key: "us", label: "US size" },
    { key: "eu", label: "EU size" },
    { key: "width", label: "Width" },
    { key: "heel", label: "Heel height", unit: "in" },
  ],
  Bags: [
    { key: "width", label: "Width", unit: "in" },
    { key: "height", label: "Height", unit: "in" },
    { key: "depth", label: "Depth", unit: "in" },
    { key: "strapDrop", label: "Strap drop", unit: "in" },
  ],
  Accessories: [
    { key: "length", label: "Length", unit: "in" },
    { key: "width", label: "Width", unit: "in" },
  ],
  Activewear: [
    { key: "band", label: "Band (bras)" },
    { key: "cup", label: "Cup (bras)" },
    { key: "bust", label: "Bust", unit: "in" },
    { key: "waist", label: "Waist", unit: "in" },
  ],
  Loungewear: [
    { key: "bust", label: "Bust", unit: "in" },
    { key: "waist", label: "Waist", unit: "in" },
    { key: "length", label: "Length", unit: "in" },
  ],
  Jewelry: [
    { key: "ringSize", label: "Ring size" },
    { key: "necklaceLength", label: "Necklace length", unit: "in" },
    { key: "braceletLength", label: "Bracelet length", unit: "in" },
    { key: "metal", label: "Metal" },
    { key: "stone", label: "Stone" },
  ],
  Bras: [
    { key: "band", label: "Band size" },
    { key: "cup", label: "Cup" },
    { key: "underwireType", label: "Wire / wireless" },
    { key: "fitNotes", label: "Fit notes" },
  ],
  Underwear: [
    { key: "size", label: "Size" },
    { key: "rise", label: "Rise" },
    { key: "fabric", label: "Fabric" },
  ],
  Swimwear: [
    { key: "size", label: "Size" },
    { key: "bust", label: "Bust", unit: "in" },
    { key: "waist", label: "Waist", unit: "in" },
    { key: "hip", label: "Hip", unit: "in" },
  ],
  "Socks & Hosiery": [
    { key: "size", label: "Size" },
    { key: "denier", label: "Denier (hosiery)" },
  ],
};

export function parseFitDetails(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim()) out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function serializeFitDetails(values: Record<string, string>): string | null {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = (v ?? "").trim();
    if (t) cleaned[k] = t;
  }
  return Object.keys(cleaned).length === 0 ? null : JSON.stringify(cleaned);
}
