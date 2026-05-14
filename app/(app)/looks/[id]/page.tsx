import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import LookBuilder, { type PickableItem, type InitialLook } from "../LookBuilder";

export const dynamic = "force-dynamic";

// /looks/[id] — single-look detail / edit page. Always shows the
// builder in edit mode (no read-only split) since a Look's "view" is
// just the same slot grid with all picks already chosen. The user
// changes a slot inline and taps Save to PATCH.
//
// Loads the same isBeauty=true item set as /looks/new, plus the
// owner-scoped Look itself. Missing / cross-user ids → notFound().
export default async function LookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const [look, items] = await Promise.all([
    prisma.look.findFirst({
      where: { id, ownerId: userId },
      include: { items: { select: { itemId: true, slot: true } } },
    }),
    prisma.item.findMany({
      where: { ownerId: userId, isBeauty: true, status: "active" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        imagePath: true,
        imageBgRemovedPath: true,
        category: true,
        subType: true,
        brand: true,
        shadeName: true,
        shadeHex: true,
      },
    }),
  ]);
  if (!look) notFound();

  const initial: InitialLook = {
    id: look.id,
    name: look.name,
    notes: look.notes,
    items: look.items.map((i) => ({ itemId: i.itemId, slot: i.slot })),
  };
  const picks: PickableItem[] = items;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/looks" className="text-sm text-blush-600 hover:underline">← Looks</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{look.name}</h1>
        <p className="text-sm text-stone-500">Edit slots inline. Save commits the change.</p>
      </div>
      <LookBuilder items={picks} initial={initial} />
    </div>
  );
}
