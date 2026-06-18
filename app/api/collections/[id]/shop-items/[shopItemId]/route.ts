import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { unlinkUpload } from "@/lib/uploads";
import { isKnownCategory, COLOR_NAMES } from "@/lib/constants";

export const runtime = "nodejs";

// Accept https:// URLs and bare domains ("madewell.com/...") so a user
// editing a photo-only card can paste either. The bare-domain form
// gets canonicalized to https:// before save.
const URL_RE = /^https?:\/\//i;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;

function hostOf(input: string): string | undefined {
  try {
    const url = URL_RE.test(input) ? input : `https://${input}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// Confirm the shop item exists, belongs to a collection the caller owns,
// and return it. Centralizes the owner-scope check both handlers need.
async function ownedShopItem(userId: string, collectionId: string, shopItemId: string) {
  return prisma.collectionShopItem.findFirst({
    where: { id: shopItemId, collectionId, collection: { ownerId: userId } },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shopItemId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, shopItemId } = await params;

  const existing = await ownedShopItem(userId, id, shopItemId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const data: Record<string, unknown> = {};
  if (typeof body.purchased === "boolean") data.purchased = body.purchased;
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 600) || null;

  // Field edits — useful both for photo-only cards (the user adds a
  // link / brand / category after the fact) and for correcting any
  // AI-tagged field on a paste-link card. Each field validates the
  // same way the create path does.
  if (typeof body.link === "string") {
    const raw = body.link.trim();
    if (!raw) {
      // Empty string clears the link.
      data.link = null;
      data.source = null;
    } else if (!URL_RE.test(raw) && !BARE_DOMAIN_RE.test(raw)) {
      return NextResponse.json(
        { error: "That doesn't look like a link. Use a full product URL (e.g. https://…)." },
        { status: 400 },
      );
    } else {
      const canonical = URL_RE.test(raw) ? raw : `https://${raw}`;
      data.link = canonical.slice(0, 2000);
      data.source = hostOf(canonical)?.slice(0, 120) ?? null;
    }
  }
  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (!v) {
      return NextResponse.json({ error: "Name can't be empty." }, { status: 400 });
    }
    data.name = v.slice(0, 120);
  }
  if (typeof body.brand === "string") {
    data.brand = body.brand.trim().slice(0, 80) || null;
  }
  if (typeof body.category === "string") {
    const v = body.category.trim();
    if (!v) {
      data.category = null;
    } else if (!isKnownCategory(v)) {
      return NextResponse.json({ error: `Unknown category "${v}".` }, { status: 400 });
    } else {
      data.category = v;
    }
  }
  if (typeof body.color === "string") {
    const v = body.color.toLowerCase().trim();
    if (!v) {
      data.color = null;
    } else if (!(COLOR_NAMES as readonly string[]).includes(v)) {
      return NextResponse.json({ error: `Unknown color "${v}".` }, { status: 400 });
    } else {
      data.color = v;
    }
  }
  if (typeof body.price === "string") {
    data.price = body.price.trim().slice(0, 60) || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.collectionShopItem.update({ where: { id: shopItemId }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; shopItemId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, shopItemId } = await params;

  const existing = await ownedShopItem(userId, id, shopItemId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.collectionShopItem.delete({ where: { id: shopItemId } });
  // Clean up the downloaded thumbnail (no-op when there was none).
  await unlinkUpload(existing.imagePath);
  return NextResponse.json({ ok: true });
}
