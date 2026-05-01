import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";
import MobileNav from "@/components/MobileNav";
import ToastHost from "@/components/Toast";
import ConfirmDialogHost from "@/components/ConfirmDialog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const firstName = firstNameFromUser(session.user);
  const wardrobeLabel = possessiveTitle("Wardrobe", firstName);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-100 bg-cream-50/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="min-w-0 truncate font-display text-xl leading-tight text-blush-700">
            {wardrobeLabel}
          </Link>
          <div className="flex items-center gap-1">
            <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Primary">
              <Link href="/wardrobe" className="btn-ghost">Closet</Link>
              <Link href="/outfits" className="btn-ghost">Outfits</Link>
              <Link href="/collections" className="btn-ghost">Collections</Link>
              <Link href="/wishlist" className="btn-ghost">Wishlist</Link>
              <Link href="/outfits/builder" className="btn-ghost">Build</Link>
              <Link
                href="/settings"
                className="btn-ghost grid h-9 w-9 place-items-center text-stone-500"
                aria-label="Settings"
                title="Settings"
              >
                <SettingsCog className="h-5 w-5" />
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="btn-ghost text-stone-500" type="submit" aria-label="Sign out">
                  Sign out
                </button>
              </form>
            </nav>
            {/* Mobile: settings + sign out */}
            <div className="flex items-center gap-1 sm:hidden">
              <Link
                href="/settings"
                className="btn-ghost grid h-8 w-8 place-items-center text-stone-500"
                aria-label="Settings"
                title="Settings"
              >
                <SettingsCog className="h-5 w-5" />
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="btn-ghost text-xs text-stone-500" type="submit" aria-label="Sign out">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-[max(7rem,calc(6rem+env(safe-area-inset-bottom)))]">{children}</main>

      <MobileNav />
      <ToastHost />
      <ConfirmDialogHost />
    </div>
  );
}

function SettingsCog({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
