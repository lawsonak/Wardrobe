import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";
import { getProvider } from "@/lib/ai/provider";
import AdminStorage from "./AdminStorage";
import BgDiagnostic from "./BgDiagnostic";
import BgCleanup from "./BgCleanup";
import PhotoOptimizerButton from "@/components/PhotoOptimizerButton";
import HiResCutoutBackfillButton from "@/components/HiResCutoutBackfillButton";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);

  const [
    items,
    outfits,
    wishlist,
    brands,
    collections,
    drafts,
    legacyItems,
    legacyAngles,
    missingHiResCutouts,
  ] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.outfit.count({ where: { ownerId: userId } }),
    prisma.wishlistItem.count({ where: { ownerId: userId } }),
    prisma.brand.count({ where: { ownerId: userId } }),
    prisma.collection.count({ where: { ownerId: userId } }),
    prisma.item.count({ where: { ownerId: userId, status: "draft" } }),
    // "Legacy" photos = uploaded before two-tier storage shipped. The
    // optimizer scans each one and only touches the ones that actually
    // need it — anything already small enough is left alone.
    prisma.item.count({ where: { ownerId: userId, imageOriginalPath: null } }),
    prisma.itemPhoto.count({
      where: { item: { ownerId: userId }, imageOriginalPath: null },
    }),
    // Items missing the full-res bg-removed cutout that powers the
    // lightbox tap-to-zoom. New uploads get one automatically via the
    // post-upload worker; this count is the backfill queue for items
    // that pre-date that worker.
    prisma.item.count({
      where: { ownerId: userId, imageBgRemovedOriginalPath: null },
    }),
  ]);
  const legacyPhotoCount = legacyItems + legacyAngles;

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

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-display text-lg text-stone-800">Two-tier photo optimizer</h2>
          <p className="mt-1 text-sm text-stone-600">
            Every new photo gets a small display variant for fast loading and keeps the
            full-resolution original for tap-to-zoom. Photos uploaded before that
            shipped — or any that slipped through — are still living as full-size files.
          </p>
          {legacyPhotoCount === 0 ? (
            <p className="mt-3 text-sm text-sage-700">
              ✓ All your photos are already in the new shape.
            </p>
          ) : (
            <>
              <p className="mt-3 text-xs text-stone-500">
                Up to {legacyPhotoCount} photo{legacyPhotoCount === 1 ? "" : "s"} need a
                check. The optimizer scans each one and only touches the ones that
                actually need it.
              </p>
              <div className="mt-3">
                <PhotoOptimizerButton />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-stone-100 pt-4">
          <h3 className="font-display text-sm text-stone-700">Hi-res cutouts</h3>
          <p className="mt-1 text-sm text-stone-600">
            The lightbox tap-to-zoom prefers a full-resolution background-removed
            cutout — the cleanest view of just the garment. New uploads get one
            automatically in the background; anything that pre-dates the worker
            falls back to the photo with its original background.
          </p>
          {missingHiResCutouts === 0 ? (
            <p className="mt-3 text-sm text-sage-700">
              ✓ Every item has a hi-res cutout.
            </p>
          ) : (
            <>
              <p className="mt-3 text-xs text-stone-500">
                {missingHiResCutouts} item{missingHiResCutouts === 1 ? "" : "s"} still
                missing one. The worker takes ~5–15 s per photo at full quality —
                a big batch can take a while. Runs in the background.
              </p>
              <div className="mt-3">
                <HiResCutoutBackfillButton pendingCount={missingHiResCutouts} />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Background removal</h2>
        <p className="mb-3 text-xs text-stone-500">
          Walks every item that&apos;s still using its raw photo and replaces it with a
          background-removed cutout. Runs in this tab — leave it open until done.
        </p>
        <BgCleanup />
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Background removal diagnostics</h2>
        <p className="mb-3 text-xs text-stone-500">
          The model auto-falls-back to the public CDN if the local copy
          under <code>public/vendor/imgly/</code> is missing or broken. To
          repopulate locally run <code>npm run fetch-vendor</code> on the
          server with internet, then restart the service.
        </p>
        <BgDiagnostic />
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Closet quality</h2>
        <p className="mt-1 text-sm text-stone-600">
          A data-hygiene view that lists items with missing fields and possible duplicate
          brands so you can tidy in bulk.
        </p>
        <div className="mt-3">
          <Link href="/wardrobe/quality" className="btn-secondary text-sm">
            Open closet quality
          </Link>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">AI provider</h2>
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
          Powers auto-tagging, packing lists, try-on, and shopping suggestions. Nothing
          auto-saves — suggestions are surfaced for the user to accept.
        </p>
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
