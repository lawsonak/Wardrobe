"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

type Tab = {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
};

const HOME_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);
const CLOSET_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
  </svg>
);
const OUTFITS_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 0 1-1.125-1.125v-3.75ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-2.25Z" />
  </svg>
);
const COLLECTIONS_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const TABS: Tab[] = [
  { href: "/", label: "Home", match: (p) => p === "/", icon: HOME_ICON },
  { href: "/wardrobe", label: "Closet", match: (p) => p.startsWith("/wardrobe"), icon: CLOSET_ICON },
  { href: "/outfits", label: "Outfits", match: (p) => p.startsWith("/outfits"), icon: OUTFITS_ICON },
  { href: "/collections", label: "Collections", match: (p) => p.startsWith("/collections"), icon: COLLECTIONS_ICON },
];

export default function MobileNav() {
  const pathname = usePathname() ?? "/";
  const addActive = pathname.startsWith("/wardrobe/new");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-100 bg-white/95 backdrop-blur sm:hidden"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-around px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 text-[10px]">
        {TABS.slice(0, 2).map((tab) => {
          const active = tab.match(pathname) && !addActive;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-3 py-2 transition-colors",
                active ? "text-blush-600" : "text-stone-500 hover:text-blush-500",
              )}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}

        <Link
          href="/wardrobe/new"
          aria-current={addActive ? "page" : undefined}
          className={cn(
            "flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl px-3 py-1.5 text-white shadow-md transition active:bg-blush-600",
            addActive ? "bg-blush-600" : "bg-blush-500 hover:bg-blush-600",
          )}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add
        </Link>

        {TABS.slice(2).map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-3 py-2 transition-colors",
                active ? "text-blush-600" : "text-stone-500 hover:text-blush-500",
              )}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
