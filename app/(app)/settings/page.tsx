import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const [items, outfits, wishlist, brands] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.outfit.count({ where: { ownerId: userId } }),
    prisma.wishlistItem.count({ where: { ownerId: userId } }),
    prisma.brand.count({ where: { ownerId: userId } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Settings</h1>
        <p className="text-sm text-stone-500">
          {firstName ? `Hi ${firstName}.` : ""} Useful tools and a backup button.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Backup</h2>
        <p className="mt-1 text-sm text-stone-600">
          Download a JSON snapshot of your closet, outfits, wishlist, and brands. Photos
          are referenced by path; back up the server&apos;s <code>data/uploads/</code>{" "}
          folder to keep the images.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          You currently have {items} item{items === 1 ? "" : "s"}, {outfits} outfit
          {outfits === 1 ? "" : "s"}, {wishlist} wish{wishlist === 1 ? "" : "es"}, and {brands} brand
          {brands === 1 ? "" : "s"}.
        </p>
        <a href="/api/export" className="btn-primary mt-3 inline-flex" download>
          Download backup (JSON)
        </a>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Maintenance</h2>
        <ul className="mt-2 space-y-2 text-sm">
          <li>
            <Link href="/wardrobe/needs-review" className="text-blush-600 hover:underline">
              Needs Review inbox
            </Link>
            <span className="text-stone-500"> — items waiting for tags.</span>
          </li>
          <li>
            <Link href="/wardrobe/quality" className="text-blush-600 hover:underline">
              Closet quality
            </Link>
            <span className="text-stone-500"> — find missing fields and possible duplicate brands.</span>
          </li>
          <li>
            <Link href="/wardrobe/new?batch=1" className="text-blush-600 hover:underline">
              Batch add
            </Link>
            <span className="text-stone-500"> — rapid-fire add many items in a row.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
