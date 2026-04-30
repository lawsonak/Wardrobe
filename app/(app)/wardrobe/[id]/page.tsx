import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { csvToList, SLOTS } from "@/lib/constants";
import EditItemForm from "./EditItemForm";
import ItemDetailView from "./ItemDetailView";
import ItemAngles from "./ItemAngles";
import ItemPhotoEditor from "@/components/ItemPhotoEditor";

export const dynamic = "force-dynamic";

export default async function ItemDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const editing = sp.edit === "1";

  const item = await prisma.item.findFirst({
    where: { id, ownerId: userId },
    include: {
      outfitItems: {
        include: {
          outfit: {
            include: {
              items: { include: { item: true } },
            },
          },
        },
        take: 6,
      },
      photos: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
      set: {
        include: {
          items: {
            where: { id: { not: id } },
            select: {
              id: true, imagePath: true, imageBgRemovedPath: true,
              category: true, subType: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!item) notFound();

  const sisters = item.set?.items ?? [];

  // Other closet items the user could link this one to. Excludes
  // the current item and anything already in this set. Capped at
  // 200 — closets that big can use the picker's search box.
  const sisterIds = new Set(sisters.map((s) => s.id));
  const candidateRows = await prisma.item.findMany({
    where: {
      ownerId: userId,
      status: "active",
      id: { not: id },
      ...(item.setId ? { setId: { not: item.setId } } : {}),
    },
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      brand: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const candidates = candidateRows.filter((c) => !sisterIds.has(c.id));

  const angles = item.photos.map((p) => ({
    id: p.id,
    imagePath: p.imagePath,
    imageBgRemovedPath: p.imageBgRemovedPath,
    label: p.label,
  }));

  // Default: read-only detail view.
  if (!editing) {
    // Neighbor lookup. Closet ordering is createdAt desc (newest
    // first), so:
    //   "previous" = newer item       → createdAt > current, asc
    //   "next"     = older item       → createdAt < current, desc
    const [prevItem, nextItem] = await Promise.all([
      prisma.item.findFirst({
        where: {
          ownerId: userId,
          status: "active",
          createdAt: { gt: item.createdAt },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
      prisma.item.findFirst({
        where: {
          ownerId: userId,
          status: "active",
          createdAt: { lt: item.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);

    const detailOutfits = item.outfitItems.map((oi) => {
      // Sort companion items by canonical slot order so the thumbnail
      // strip looks like a real outfit (top → bottom → shoes), and
      // pull just enough thumbs for the row preview.
      const sorted = [...oi.outfit.items].sort(
        (a, b) =>
          (SLOTS as readonly string[]).indexOf(a.slot) -
          (SLOTS as readonly string[]).indexOf(b.slot),
      );
      return {
        id: oi.outfit.id,
        name: oi.outfit.name,
        thumbs: sorted.slice(0, 4).map((s) => ({
          id: s.item.id,
          src: s.item.imageBgRemovedPath
            ? `/api/uploads/${s.item.imageBgRemovedPath}`
            : `/api/uploads/${s.item.imagePath}`,
        })),
      };
    });

    return (
      <ItemDetailView
        item={{
          id: item.id,
          imagePath: item.imagePath,
          imageBgRemovedPath: item.imageBgRemovedPath ?? null,
          labelImagePath: item.labelImagePath ?? null,
          category: item.category,
          subType: item.subType,
          color: item.color,
          brand: item.brand,
          size: item.size,
          fitDetails: item.fitDetails ?? null,
          fitNotes: item.fitNotes ?? null,
          notes: item.notes,
          seasons: item.seasons,
          activities: item.activities,
          isFavorite: item.isFavorite,
          status: item.status,
        }}
        outfits={detailOutfits}
        angles={angles}
        setId={item.setId ?? null}
        setName={item.set?.name ?? null}
        sisters={sisters}
        candidates={candidates}
        prevId={prevItem?.id ?? null}
        nextId={nextItem?.id ?? null}
      />
    );
  }

  // Edit mode: hero photo + photo tools + the existing edit form.
  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
  const labelSrc = item.labelImagePath ? `/api/uploads/${item.labelImagePath}` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/wardrobe/${item.id}`} className="text-sm text-blush-600 hover:underline">
          ← Done editing
        </Link>
        <p className="text-xs uppercase tracking-wide text-stone-500">Edit mode</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Images column */}
        <div className="space-y-3">
          <div className="tile-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain" />
          </div>

          {labelSrc && (
            <div>
              <p className="label mb-1">Label / tag photo</p>
              <div className="overflow-hidden rounded-xl ring-1 ring-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={labelSrc} alt="Label tag" className="max-h-72 w-full bg-cream-50 object-contain p-2" />
              </div>
            </div>
          )}

          <ItemPhotoEditor
            itemId={item.id}
            imagePath={item.imagePath}
            hasBgRemoved={!!item.imageBgRemovedPath}
            hasLabelPhoto={!!labelSrc}
          />
          <div className="border-t border-stone-100 pt-3">
            <p className="label mb-2">Other angles</p>
            <ItemAngles itemId={item.id} angles={angles} editing />
          </div>
        </div>

        {/* Edit form column */}
        <div>
          <EditItemForm
            item={{
              id: item.id,
              imagePath: item.imagePath,
              imageBgRemovedPath: item.imageBgRemovedPath ?? null,
              labelImagePath: item.labelImagePath ?? null,
              category: item.category,
              subType: item.subType,
              color: item.color,
              brand: item.brand,
              brandId: item.brandId ?? null,
              fitDetails: item.fitDetails ?? null,
              fitNotes: item.fitNotes ?? null,
              size: item.size,
              notes: item.notes,
              seasons: csvToList(item.seasons),
              activities: csvToList(item.activities),
              isFavorite: item.isFavorite,
              status: item.status,
            }}
          />
        </div>
      </div>
    </div>
  );
}
