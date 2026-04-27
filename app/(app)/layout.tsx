import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-100 bg-cream-50/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl text-blush-700">
            Wardrobe
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/wardrobe" className="btn-ghost">Closet</Link>
            <Link href="/outfits" className="btn-ghost">Outfits</Link>
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
        </div>
      </header>
      <main className="flex-1 px-4 py-6 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-100 bg-white/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-around p-2 text-xs">
          <Link href="/" className="flex flex-col items-center gap-1 px-3 py-1 text-stone-600">Home</Link>
          <Link href="/wardrobe" className="flex flex-col items-center gap-1 px-3 py-1 text-stone-600">Closet</Link>
          <Link href="/wardrobe/new" className="flex flex-col items-center gap-1 px-3 py-1 font-semibold text-blush-600">+ Add</Link>
          <Link href="/outfits" className="flex flex-col items-center gap-1 px-3 py-1 text-stone-600">Outfits</Link>
          <Link href="/outfits/builder" className="flex flex-col items-center gap-1 px-3 py-1 text-stone-600">Build</Link>
        </div>
      </nav>
    </div>
  );
}
