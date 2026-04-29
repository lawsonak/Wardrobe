import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import StyleCanvas, { type CanvasItem } from "@/components/StyleCanvas";
import { getMannequinForUser } from "@/lib/mannequin";
import { getOutfitRender } from "@/lib/outfitRender";

export const dynamic = "force-dynamic";

export default async function StyleCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const outfit = await prisma.outfit.findFirst({
    where: { id, ownerId: userId },
    include: {
      items: {
        include: { item: true },
      },
    },
  });
  if (!outfit) notFound();

  const [mannequin, render] = await Promise.all([
    getMannequinForUser(userId),
    getOutfitRender(userId, outfit.id),
  ]);

  const items: CanvasItem[] = outfit.items.map((oi) => ({
    id: oi.item.id,
    imagePath: oi.item.imagePath,
    imageBgRemovedPath: oi.item.imageBgRemovedPath,
    category: oi.item.category,
    subType: oi.item.subType,
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/outfits" className="text-sm text-blush-600 hover:underline">← Back to outfits</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{outfit.name}</h1>
        <p className="text-sm text-stone-500">
          Drag to move, pinch the bottom-right to resize, twist the top-left to rotate. Saves automatically.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-stone-500">
          This outfit has no pieces to layout.
        </div>
      ) : (
        <StyleCanvas
          outfitId={outfit.id}
          items={items}
          initialLayoutJson={outfit.layoutJson}
          mannequinSrc={mannequin.url}
          landmarks={mannequin.landmarks}
          renderedSrc={render.url}
        />
      )}
    </div>
  );
}
