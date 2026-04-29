import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";
import NotificationBell from "@/components/NotificationBell";
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
            <NotificationBell />
            <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Primary">
              <Link href="/wardrobe" className="btn-ghost">Closet</Link>
              <Link href="/outfits" className="btn-ghost">Outfits</Link>
              <Link href="/wishlist" className="btn-ghost">Wishlist</Link>
              <Link href="/outfits/builder" className="btn-ghost">Build</Link>
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
            {/* Mobile: sign out only */}
            <form
              className="sm:hidden"
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
      </header>

      <main className="flex-1 px-4 py-6 pb-[max(7rem,calc(6rem+env(safe-area-inset-bottom)))]">{children}</main>

      <MobileNav />
      <ToastHost />
      <ConfirmDialogHost />
    </div>
  );
}
