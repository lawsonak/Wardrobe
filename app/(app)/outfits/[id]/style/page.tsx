import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { type CanvasItem } from "@/components/StyleCanvas";
import TryOnView from "@/components/TryOnView";
import { getUserMannequin } from "@/lib/mannequin";

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

  const items: CanvasItem[] = outfit.items.map((oi) => ({
    id: oi.item.id,
    imagePath: oi.item.imagePath,
    imageBgRemovedPath: oi.item.imageBgRemovedPath,
    category: oi.item.category,
    subType: oi.item.subType,
  }));

  // Optional stylized head overlay — when the user has set one up in
  // Settings → Your mannequin, the try-on view stacks it on top of
  // the AI body via CSS positioning.
  const mannequin = await getUserMannequin(userId);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/outfits" className="text-sm text-blush-600 hover:underline">← Back to outfits</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">{outfit.name}</h1>
        <p className="text-sm text-stone-500">
          Generate an AI try-on, or switch to manual layout to drag pieces yourself.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-stone-500">
          This outfit has no pieces to layout.
        </div>
      ) : (
        <TryOnView
          outfitId={outfit.id}
          items={items}
          initialLayoutJson={outfit.layoutJson}
          initialTryOnImagePath={outfit.tryOnImagePath}
          initialTryOnGeneratedAt={outfit.tryOnGeneratedAt ? outfit.tryOnGeneratedAt.toISOString() : null}
          headUrl={mannequin.headUrl}
          headBBox={mannequin.headBBox}
        />
      )}
    </div>
  );
}
