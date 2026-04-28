import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import WishlistForm from "../../WishlistForm";

export const dynamic = "force-dynamic";

export default async function EditWishlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const item = await prisma.wishlistItem.findUnique({ where: { id } });
  if (!item || item.ownerId !== userId) notFound();

  return (
    <div className="space-y-5">
      <Link href="/wishlist" className="text-sm text-blush-600 hover:underline">← Back to wishlist</Link>
      <div>
        <h1 className="font-display text-3xl text-blush-700">Edit wish</h1>
      </div>
      <WishlistForm
        initial={{
          id: item.id,
          name: item.name,
          category: item.category,
          brand: item.brand,
          link: item.link,
          price: item.price,
          priority: item.priority,
          occasion: item.occasion,
          notes: item.notes,
          fillsGap: item.fillsGap,
          giftIdea: item.giftIdea,
          imagePath: item.imagePath,
        }}
      />
    </div>
  );
}
