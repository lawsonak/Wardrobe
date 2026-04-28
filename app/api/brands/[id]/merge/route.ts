import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { brandKey } from "@/lib/brand";

export const runtime = "nodejs";

// Merge brand `id` (source) into `targetId` (canonical):
// - All Items pointing at source.brandId get pointed at target.
// - Items' `brand` text field is updated to target's name.
// - Source's name + each of its aliases become aliases on target.
// - Source row is deleted.
// All in one transaction so we can't end up with dangling refs.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: sourceId } = await params;
  const body = await req.json().catch(() => ({}));
  const targetId = String(body.targetId ?? "").trim();
  if (!targetId) return NextResponse.json({ error: "targetId required" }, { status: 400 });
  if (targetId === sourceId) return NextResponse.json({ error: "Cannot merge into itself" }, { status: 400 });

  const [source, target] = await Promise.all([
    prisma.brand.findFirst({
      where: { id: sourceId, ownerId: userId },
      include: { aliases: true },
    }),
    prisma.brand.findFirst({ where: { id: targetId, ownerId: userId } }),
  ]);
  if (!source || !target) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.item.updateMany({
      where: { ownerId: userId, brandId: source.id },
      data: { brandId: target.id, brand: target.name },
    });

    // Insert source.name + source aliases as aliases on target, dropping
    // dupes by aliasKey within the target.
    const aliasInputs = [
      { alias: source.name, aliasKey: brandKey(source.name) },
      ...source.aliases.map((a) => ({ alias: a.alias, aliasKey: a.aliasKey })),
    ].filter((a) => a.aliasKey && a.aliasKey !== target.nameKey);
    for (const a of aliasInputs) {
      await tx.brandAlias.upsert({
        where: { brandId_aliasKey: { brandId: target.id, aliasKey: a.aliasKey } },
        update: {},
        create: { brandId: target.id, alias: a.alias, aliasKey: a.aliasKey },
      });
    }

    // Source aliases will cascade-delete when the brand row is removed.
    await tx.brand.delete({ where: { id: source.id } });
  });

  return NextResponse.json({ ok: true });
}
