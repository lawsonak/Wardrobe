import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { type CanvasItem } from "@/components/StyleCanvas";
import TryOnView from "@/components/TryOnView";

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
      // Pull the paired Look (if any) with enough product detail to
      // render a thumbnail strip below the try-on.
      look: {
        include: {
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  imagePath: true,
                  imageBgRemovedPath: true,
                  category: true,
                  subType: true,
                  shadeName: true,
                  shadeHex: true,
                },
              },
            },
          },
        },
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
        />
      )}

      {/* Paired Look — render the product strip below the try-on so
          the user sees "wearing this outfit + this face" as a single
          glance. Click the heading or any thumb to open the look in
          edit mode. */}
      {outfit.look && (
        <section className="card space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Link
              href={`/looks/${outfit.look.id}`}
              className="font-display text-lg text-stone-800 hover:text-blush-700"
            >
              💄 {outfit.look.name}
            </Link>
            <span className="text-xs text-stone-500">
              Paired look — {outfit.look.items.length} product
              {outfit.look.items.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="flex flex-wrap gap-3">
            {outfit.look.items.map((li) => {
              const src = li.item.imageBgRemovedPath
                ? `/api/uploads/${li.item.imageBgRemovedPath}`
                : `/api/uploads/${li.item.imagePath}`;
              return (
                <li key={li.id} className="w-20 space-y-1 text-xs">
                  <Link
                    href={`/wardrobe/${li.item.id}`}
                    className="tile-bg flex aspect-square w-20 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100 hover:ring-blush-300"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={li.item.subType ?? li.item.category}
                      className="h-full w-full object-contain p-1"
                    />
                  </Link>
                  <p className="truncate text-stone-700">{li.slot}</p>
                  {li.item.shadeName && (
                    <p className="flex items-center gap-1 truncate text-[10px] text-stone-500">
                      {li.item.shadeHex && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white"
                          style={{ backgroundColor: li.item.shadeHex }}
                        />
                      )}
                      {li.item.shadeName}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
