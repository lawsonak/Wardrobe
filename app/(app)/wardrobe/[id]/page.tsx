import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { csvToList } from "@/lib/constants";
import EditItemForm from "./EditItemForm";
import ItemPhotoEditor from "@/components/ItemPhotoEditor";

export const dynamic = "force-dynamic";

export default async function ItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      outfitItems: {
        include: { outfit: true },
        take: 5,
      },
    },
  });
  if (!item) notFound();

  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;

  const labelSrc = item.labelImagePath ? `/api/uploads/${item.labelImagePath}` : null;

  const seasons = csvToList(item.seasons);
  const activities = csvToList(item.activities);

  return (
    <div className="space-y-5">
      <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Back to closet</Link>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Images column */}
        <div className="space-y-3">
          <div className="tile-bg grid aspect-square w-full place-items-center overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain p-4" />
          </div>

          {labelSrc && (
            <div>
              <p className="label mb-1">Label / tag photo</p>
              <div className="overflow-hidden rounded-xl ring-1 ring-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={labelSrc} alt="Label tag" className="max-h-72 w-full object-contain bg-cream-50 p-2" />
              </div>
            </div>
          )}

          <ItemPhotoEditor
            itemId={item.id}
            imagePath={item.imagePath}
            hasBgRemoved={!!item.imageBgRemovedPath}
            hasLabelPhoto={!!labelSrc}
          />

          {/* Quick metadata summary below image on mobile */}
          <div className="card p-3 sm:hidden">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {item.category && (
                <>
                  <dt className="text-stone-500">Category</dt>
                  <dd className="font-medium">{item.category}</dd>
                </>
              )}
              {item.subType && (
                <>
                  <dt className="text-stone-500">Type</dt>
                  <dd className="font-medium">{item.subType}</dd>
                </>
              )}
              {item.brand && (
                <>
                  <dt className="text-stone-500">Brand</dt>
                  <dd className="font-medium">{item.brand}</dd>
                </>
              )}
              {item.size && (
                <>
                  <dt className="text-stone-500">Size</dt>
                  <dd className="font-medium">{item.size}</dd>
                </>
              )}
              {item.color && (
                <>
                  <dt className="text-stone-500">Color</dt>
                  <dd className="font-medium capitalize">{item.color}</dd>
                </>
              )}
              {seasons.length > 0 && (
                <>
                  <dt className="text-stone-500">Seasons</dt>
                  <dd className="font-medium capitalize">{seasons.join(", ")}</dd>
                </>
              )}
              {activities.length > 0 && (
                <>
                  <dt className="text-stone-500">Activities</dt>
                  <dd className="font-medium capitalize">{activities.join(", ")}</dd>
                </>
              )}
            </dl>
            {item.notes && (
              <p className="mt-2 text-xs text-stone-500 border-t border-stone-100 pt-2">{item.notes}</p>
            )}
          </div>
        </div>

        {/* Edit form column */}
        <div className="space-y-4">
          <EditItemForm
            item={{
              id: item.id,
              imagePath: item.imagePath,
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

          {/* Outfits using this item */}
          {item.outfitItems.length > 0 && (
            <div className="card p-4">
              <p className="label mb-2">In outfits</p>
              <ul className="space-y-1">
                {item.outfitItems.map((oi) => (
                  <li key={oi.id}>
                    <Link href="/outfits" className="text-sm text-blush-600 hover:underline">
                      {oi.outfit.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
