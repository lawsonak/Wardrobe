import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { firstNameFromUser, possessiveTitle } from "@/lib/userName";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const firstName = firstNameFromUser(session.user);
  const wardrobeLabel = possessiveTitle("Wardrobe", firstName);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-100 bg-cream-50/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl text-blush-700 leading-tight">
            {wardrobeLabel}
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
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
            <button className="btn-ghost text-xs text-stone-500" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-[max(7rem,calc(6rem+env(safe-area-inset-bottom)))]">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-100 bg-white/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-around px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 text-[10px]">
          <Link href="/" className="flex flex-col items-center gap-0.5 px-2 py-2 text-stone-500 active:text-blush-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            Home
          </Link>
          <Link href="/wardrobe" className="flex flex-col items-center gap-0.5 px-2 py-2 text-stone-500 active:text-blush-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
            </svg>
            Closet
          </Link>
          <Link href="/wardrobe/new" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl bg-blush-500 text-white shadow-md active:bg-blush-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </Link>
          <Link href="/outfits" className="flex flex-col items-center gap-0.5 px-2 py-2 text-stone-500 active:text-blush-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 0 1-1.125-1.125v-3.75ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-2.25Z" />
            </svg>
            Outfits
          </Link>
          <Link href="/wishlist" className="flex flex-col items-center gap-0.5 px-2 py-2 text-stone-500 active:text-blush-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
            Wishlist
          </Link>
        </div>
      </nav>
    </div>
  );
}
