import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { unlinkUpload } from "@/lib/uploads";

export const runtime = "nodejs";

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
