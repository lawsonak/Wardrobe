import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { firstNameFromUser } from "@/lib/userName";
import { getPrefs, setHomeCity, setStylePreferences } from "@/lib/userPrefs";
import { getForecast, cToF } from "@/lib/weather";
import { getUserMannequin } from "@/lib/mannequin";
import MannequinUpload from "@/components/MannequinUpload";
import ShowOnboardingLink from "@/components/ShowOnboardingLink";

export const dynamic = "force-dynamic";

async function saveHomeCityAction(formData: FormData) {
  "use server";
  const value = String(formData.get("homeCity") ?? "");
  await setHomeCity(value);
  revalidatePath("/");
  revalidatePath("/settings");
}

async function saveStylePrefsAction(formData: FormData) {
  "use server";
  const value = String(formData.get("stylePreferences") ?? "");
  await setStylePreferences(value);
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const firstName = firstNameFromUser(session?.user);
  const prefs = await getPrefs();

  const [items, outfits, wishlist, brands, forecast, mannequin] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.outfit.count({ where: { ownerId: userId } }),
    prisma.wishlistItem.count({ where: { ownerId: userId } }),
    prisma.brand.count({ where: { ownerId: userId } }),
    prefs.homeCity ? getForecast(prefs.homeCity) : Promise.resolve(null),
    getUserMannequin(userId),
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
        <h2 className="font-display text-lg text-stone-800">Your mannequin</h2>
        <p className="mt-1 text-sm text-stone-600">
          Upload a photo of yourself and we&apos;ll turn it into a soft fashion-illustration
          mannequin shaped like you. The AI try-on composites your outfits onto this figure
          instead of the generic default.
        </p>
        <div className="mt-3">
          <MannequinUpload initial={mannequin} />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Home city</h2>
        <p className="mt-1 text-sm text-stone-600">
          Used to tailor &ldquo;Today&apos;s outfit&rdquo; on your dashboard with the local weather.
          Optional — leave blank to skip.
        </p>
        <form action={saveHomeCityAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="homeCity"
            defaultValue={prefs.homeCity ?? ""}
            placeholder="e.g. Brooklyn, NY"
            className="input flex-1 min-w-[14rem]"
            aria-label="Home city"
          />
          <button type="submit" className="btn-primary">Save</button>
        </form>
        {forecast && (
          <p className="mt-3 text-xs text-stone-500">
            Showing {forecast.city}{forecast.country ? `, ${forecast.country}` : ""}: {cToF(forecast.tempC)}°F, {forecast.conditions}.
          </p>
        )}
        {prefs.homeCity && !forecast && (
          <p className="mt-3 text-xs text-stone-500">
            Couldn&apos;t look up &ldquo;{prefs.homeCity}&rdquo; just now — try a more specific name.
          </p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg text-stone-800">Style preferences</h2>
        <p className="mt-1 text-sm text-stone-600">
          Free-form notes for the AI to factor in when picking outfits or making
          suggestions. A few examples:
        </p>
        <ul className="mt-2 list-disc pl-5 text-xs text-stone-500">
          <li>I don&apos;t like wearing pink and blue together.</li>
          <li>I always wear denim with sunglasses.</li>
          <li>Avoid oversized fits; I prefer tailored silhouettes.</li>
          <li>I never wear yellow.</li>
        </ul>
        <form action={saveStylePrefsAction} className="mt-3 space-y-2">
          <textarea
            name="stylePreferences"
            defaultValue={prefs.stylePreferences ?? ""}
            placeholder="Anything you want the AI to remember about your style…"
            className="input min-h-[7rem] w-full resize-y"
            maxLength={1500}
            aria-label="Style preferences"
          />
          <button type="submit" className="btn-primary">Save preferences</button>
        </form>
      </section>

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
              Quick add
            </Link>
            <span className="text-stone-500"> — snap photos one at a time; the camera reopens after each save.</span>
          </li>
          <li>
            <Link href="/wardrobe/bulk" className="text-blush-600 hover:underline">
              Import from library
            </Link>
            <span className="text-stone-500"> — pick a stack of existing photos at once; AI tags them in the background.</span>
          </li>
          <li>
            <Link href="/collections" className="text-blush-600 hover:underline">
              Collections
            </Link>
            <span className="text-stone-500"> — plan trips with destination + dates and AI-curated packing lists.</span>
          </li>
          <li>
            <Link href="/sets" className="text-blush-600 hover:underline">
              Matching sets
            </Link>
            <span className="text-stone-500"> — link pieces that came together (swimsuit top + bottom, pajamas) without locking them into one outfit.</span>
          </li>
          <li>
            <Link href="/admin" className="text-blush-600 hover:underline">
              Maintenance
            </Link>
            <span className="text-stone-500"> — storage stats, orphaned photo cleanup, AI status.</span>
          </li>
          <li>
            <ShowOnboardingLink />
            <span className="text-stone-500"> — bring back the dashboard checklist if you dismissed it.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
