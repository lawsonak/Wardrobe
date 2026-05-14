import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";
import { getPrefs } from "@/lib/userPrefs";
import { csvToList, slotForItem } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// POST /api/items/[id]/build-and-tryon
//
// One-click "Try on" from the item detail page. Asks AI to build a
// full outfit anchored around this item, persists it as a new
// Outfit, and returns the new outfit id. The client navigates to
// /outfits/{id}/style which auto-fires the try-on render via the
// existing TryOnView mount effect.
//
// Body: optional { occasion?, season? } — passed straight into the
// AI prompt. Defaults to a neutral occasion that emphasises the
// anchor item's category + subType + color.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const anchor = await prisma.item.findFirst({
    where: { id, ownerId: userId },
    select: {
      id: true,
      category: true,
      subType: true,
      color: true,
      brand: true,
      seasons: true,
      activities: true,
    },
  });
  if (!anchor) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.buildOutfit !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support outfit suggestions yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const userOccasion = typeof body.occasion === "string" ? body.occasion.trim() : "";
  const season = typeof body.season === "string" ? body.season.trim() : "";

  // Anchor descriptor injected into the prompt so the model knows the
  // outfit must include this specific piece. We force-include the
  // anchor item below regardless, but giving the model a heads-up
  // produces noticeably better complementary picks (it'll choose a
  // top that goes with the anchor pants instead of returning two
  // bottoms).
  const anchorDesc = [anchor.color, anchor.subType ?? anchor.category]
    .filter(Boolean)
    .join(" ");
  const occasion =
    userOccasion ||
    `Outfit including this ${anchorDesc} (item id ${anchor.id}). Pick complementary pieces from my closet.`;

  // The catalog mirrors /api/ai/outfit's shape. Spicy items are
  // hard-excluded — Try-on lives on the item detail page which is
  // accessible from both the main closet and the 🌶 page; if the
  // anchor itself is spicy we'd want spicy items in the prompt, but
  // that's a follow-up.
  const items = await prisma.item.findMany({
    where: { ownerId: userId, status: "active", isBackroom: false, isBeauty: false },
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  const prefs = await getPrefs();
  const result = await provider.buildOutfit({
    occasion: [occasion, season ? `season: ${season}` : ""].filter(Boolean).join(" · "),
    items: items.map((i) => ({
      id: i.id,
      category: i.category,
      subType: i.subType,
      color: i.color,
      brand: i.brand,
      seasons: csvToList(i.seasons),
      activities: csvToList(i.activities),
    })),
    preferences: prefs.stylePreferences ?? undefined,
  });

  // Force-include the anchor — if AI somehow ignored it (rare, but
  // happens on edge cases like swimwear), prepend it.
  const aiPicked = new Set<string>(result.itemIds);
  const finalIds: string[] = [...result.itemIds];
  if (!aiPicked.has(anchor.id)) finalIds.unshift(anchor.id);

  // Resolve each id to a (slot, itemId) pair via the same
  // category-to-slot map the builder uses. Drop ids whose slot is
  // already occupied so the outfit doesn't end up with two tops.
  const byId = new Map(items.map((i) => [i.id, i]));
  // The anchor row was filtered out by the spicy guard above for
  // backroom anchors; make sure it's reachable for slot lookup.
  if (!byId.has(anchor.id)) {
    byId.set(anchor.id, {
      ...anchor,
      // Pad with whatever findMany would have returned. We only need
      // category/subType/seasons/activities for slotForItem, so the
      // rest can be null without breaking the outfit save.
      ownerId: userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as (typeof items)[number]);
  }
  const usedSlots = new Set<string>();
  const cleanItems: Array<{ itemId: string; slot: string }> = [];
  for (const itemId of finalIds) {
    const it = byId.get(itemId);
    if (!it) continue;
    const slot = slotForItem(it.category, it.subType);
    if (!slot || usedSlots.has(slot)) continue;
    usedSlots.add(slot);
    cleanItems.push({ itemId, slot });
  }

  if (cleanItems.length === 0) {
    return NextResponse.json(
      { error: "Couldn't build an outfit — closet may be too small." },
      { status: 400 },
    );
  }

  const outfit = await prisma.outfit.create({
    data: {
      ownerId: userId,
      name: `Try-on: ${anchorDesc || anchor.category}`,
      activity: null,
      season: season || null,
      isFavorite: false,
      items: { create: cleanItems },
    },
  });

  await logActivity({
    userId,
    kind: "outfit.create",
    summary: `Built try-on outfit anchored on ${anchorDesc || anchor.category}`,
    targetType: "Outfit",
    targetId: outfit.id,
    meta: { pieces: cleanItems.length, anchorItemId: anchor.id },
  });

  return NextResponse.json({ outfitId: outfit.id, pieces: cleanItems.length });
}
