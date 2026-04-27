"use client";

import { useEffect, useState } from "react";

const KEY = "wardrobe.giftBanner.dismissed";

export default function GiftBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(KEY) !== "1") setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blush-200 via-blush-100 to-cream-100 p-5 shadow-card ring-1 ring-blush-200">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/80 text-stone-500 hover:text-stone-800"
        onClick={() => {
          window.localStorage.setItem(KEY, "1");
          setShow(false);
        }}
      >
        ×
      </button>
      <p className="font-display text-2xl text-blush-700">Happy Mother&apos;s Day 💝</p>
      <p className="mt-1 max-w-md text-sm text-stone-700">
        I made you a little place for everything you love to wear. Snap photos of your pieces, save your
        favorites, and mix and match outfits any time. Love you.
      </p>
    </div>
  );
}
