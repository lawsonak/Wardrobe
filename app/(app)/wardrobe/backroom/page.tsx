import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ClosetGallery from "../ClosetGallery";

export const dynamic = "force-dynamic";

// Dedicated Backroom view — only items where isBackroom=true. Reached
// from the lock icon in the closet header. Stays a separate page (vs.
// reusing the closet with a flag) so a passing glance over the user's
// shoulder on the main /wardrobe URL never accidentally surfaces
// intimate items.
export default async function BackroomPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const items = await prisma.item.findMany({
    where: { ownerId: userId, isBackroom: true, status: { not: "draft" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      color: true,
      isFavorite: true,
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
          <h1 className="mt-1 font-display text-3xl text-blush-700">🔒 Backroom</h1>
          <p className="text-sm text-stone-500">
            {items.length} item{items.length === 1 ? "" : "s"} hidden from the main closet, outfit builder, and AI prompts.
          </p>
        </div>
        <Link href="/wardrobe/new?backroom=1" className="btn-primary whitespace-nowrap">+ Add</Link>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>🔒</div>
          <p className="mt-3 font-display text-2xl text-blush-700">Nothing in the Backroom yet.</p>
          <p className="mt-1 text-stone-600">
            Mark any item as Backroom from its edit page to keep it out of
            the default closet, outfit builder, collection picker, and AI
            prompts.
          </p>
        </div>
      ) : (
        <ClosetGallery items={items} />
      )}
    </div>
  );
}
