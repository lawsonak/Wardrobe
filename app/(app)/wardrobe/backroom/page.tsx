import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ClosetGallery from "../ClosetGallery";

export const dynamic = "force-dynamic";

// Spicy — the dedicated home for `isBackroom = true` items. Reached
// from the 🌶 icon in the main closet header; the closet itself
// otherwise has zero references to spicy items (no toggles, no
// filters). Keeping this fully separate means a passing glance at the
// main /wardrobe URL never surfaces intimates.
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
          <h1 className="mt-1 font-display text-3xl text-blush-700">🌶 Spicy</h1>
          <p className="text-sm text-stone-500">
            {items.length} item{items.length === 1 ? "" : "s"} kept separate from the main closet, outfit builder, and AI prompts.
          </p>
        </div>
        <Link href="/wardrobe/new?backroom=1" className="btn-primary whitespace-nowrap">+ Add</Link>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl" aria-hidden>🌶</div>
          <p className="mt-3 font-display text-2xl text-blush-700">Nothing spicy here yet.</p>
          <p className="mt-1 text-stone-600">
            Mark any item as Spicy from its edit page to keep it out of
            the main closet, outfit builder, collection picker, and AI
            prompts.
          </p>
        </div>
      ) : (
        <ClosetGallery items={items} />
      )}
    </div>
  );
}
