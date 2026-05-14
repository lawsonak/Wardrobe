import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import LookBuilder, { type PickableItem } from "../LookBuilder";

export const dynamic = "force-dynamic";

// /looks/new — builder for a fresh Look. Pre-loads the caller's
// beauty inventory so the slot picker doesn't round-trip on open.
// Owner-scope + isBeauty are non-negotiable here — clothing can't
// land in a Look even via direct API misuse (the PATCH guard
// double-checks server-side).
export default async function NewLookPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const items = await prisma.item.findMany({
    where: { ownerId: userId, isBeauty: true, status: "active" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imagePath: true,
      imageBgRemovedPath: true,
      category: true,
      subType: true,
      brand: true,
      shadeName: true,
      shadeHex: true,
    },
  });
  const picks: PickableItem[] = items;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/looks" className="text-sm text-blush-600 hover:underline">← Looks</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">New look</h1>
        <p className="text-sm text-stone-500">
          Pick a product for each slot you want. Empty slots are fine —
          a Look needs at least one product to save.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-stone-600">
            You haven&rsquo;t added any beauty products yet. Add a few
            on the <Link href="/wardrobe/beauty" className="text-blush-600 underline">💄 page</Link>{" "}
            first.
          </p>
        </div>
      ) : (
        <LookBuilder items={picks} />
      )}
    </div>
  );
}
