import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";
import { getProvider } from "@/lib/ai/provider";
import AdminStorage from "./AdminStorage";
import BgDiagnostic from "./BgDiagnostic";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const [items, outfits, wishlist, brands, collections, drafts, needsReview] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.outfit.count({ where: { ownerId: userId } }),
    prisma.wishlistItem.count({ where: { ownerId: userId } }),
    prisma.brand.count({ where: { ownerId: userId } }),
    prisma.collection.count({ where: { ownerId: userId } }),
    prisma.item.count({ where: { ownerId: userId, status: "draft" } }),
    prisma.item.count({ where: { ownerId: userId, status: "needs_review" } }),
  ]);

  const provider = getProvider();
  const aiReady = provider.available();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-blush-600 hover:underline">← Home</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Maintenance</h1>
        <p className="text-sm text-stone-500">
          {firstName ? `${firstName}, this` : "This"} is the workshop. Storage, cleanup, and toggles.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Counts</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat label="Items" value={items} />
          <Stat label="Outfits" value={outfits} />
          <Stat label="Wishlist" value={wishlist} />
          <Stat label="Brands" value={brands} />
          <Stat label="Collections" value={collections} />
          <Stat label="Drafts" value={drafts} />
          <Stat label="Needs review" value={needsReview} />
        </dl>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Photo storage</h2>
        <p className="mb-3 text-xs text-stone-500">
          Files under <code>data/uploads/{userId.slice(0, 8)}…</code> on the server. Orphans are
          files no longer referenced by any item or wishlist row — safe to delete.
        </p>
        <AdminStorage />
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Background removal</h2>
        <p className="mb-3 text-xs text-stone-500">
          The model auto-falls-back to the public CDN if the local copy
          under <code>public/vendor/imgly/</code> is missing or broken. To
          repopulate locally run <code>npm run fetch-vendor</code> on the
          server with internet, then restart the service.
        </p>
        <BgDiagnostic />
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">AI auto-tagging</h2>
        <p className="mt-1 text-sm text-stone-600">
          Provider:{" "}
          <span className="font-medium">{provider.name}</span>
          {aiReady ? (
            <span className="ml-2 text-xs text-sage-600">Ready</span>
          ) : (
            <span className="ml-2 text-xs text-stone-400">Disabled — set AI_PROVIDER + the matching key in .env</span>
          )}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Suggestions are surfaced for the user to accept; nothing auto-saves.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Shortcuts</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li><Link href="/wardrobe/needs-review" className="text-blush-600 hover:underline">Needs Review inbox</Link></li>
          <li><Link href="/wardrobe/quality" className="text-blush-600 hover:underline">Closet quality</Link></li>
          <li><Link href="/settings" className="text-blush-600 hover:underline">Settings (backup / export)</Link></li>
          <li><Link href="/api/export" className="text-blush-600 hover:underline">Direct export download</Link></li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream-100 p-3 text-center">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="font-display text-2xl text-blush-700">{value}</p>
    </div>
  );
}
