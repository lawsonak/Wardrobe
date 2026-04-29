import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import CapsuleEditor, { type Selectable } from "../CapsuleEditor";

export const dynamic = "force-dynamic";

export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const capsule = await prisma.capsule.findFirst({
    where: { id, ownerId: userId },
    include: { items: { select: { itemId: true } } },
  });
  if (!capsule) notFound();

  const items = await prisma.item.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
  });

  const selectable: Selectable[] = items.map((i) => ({
    id: i.id,
    imagePath: i.imagePath,
    imageBgRemovedPath: i.imageBgRemovedPath,
    category: i.category,
    subType: i.subType,
    brand: i.brand,
    isFavorite: i.isFavorite,
    seasons: i.seasons,
    activities: i.activities,
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/capsules" className="text-sm text-blush-600 hover:underline">← Collections</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{capsule.name}</h1>
        <p className="text-sm text-stone-500">
          {[capsule.occasion, capsule.season].filter(Boolean).join(" · ") || "Edit pieces, occasion, and season."}
        </p>
      </div>
      <CapsuleEditor
        capsule={{
          id: capsule.id,
          name: capsule.name,
          description: capsule.description,
          occasion: capsule.occasion,
          season: capsule.season,
          itemIds: capsule.items.map((i) => i.itemId),
        }}
        items={selectable}
        mode="edit"
      />
    </div>
  );
}
