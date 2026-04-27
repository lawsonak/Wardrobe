import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { csvToList } from "@/lib/constants";
import EditItemForm from "./EditItemForm";

export const dynamic = "force-dynamic";

export default async function ItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) notFound();

  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;

  return (
    <div className="space-y-5">
      <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Back to closet</Link>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="tile-bg grid aspect-square w-full place-items-center overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={item.subType ?? item.category} className="h-full w-full object-contain p-4" />
        </div>
        <EditItemForm
          item={{
            id: item.id,
            category: item.category,
            subType: item.subType,
            color: item.color,
            brand: item.brand,
            size: item.size,
            notes: item.notes,
            seasons: csvToList(item.seasons),
            activities: csvToList(item.activities),
            isFavorite: item.isFavorite,
          }}
        />
      </div>
    </div>
  );
}
