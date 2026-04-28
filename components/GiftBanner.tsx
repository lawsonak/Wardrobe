"use client";

import { useEffect, useState } from "react";

const KEY = "wardrobe.giftBanner.dismissed";

// Subtle ribbon at the very top of the dashboard. Tappable to expand the
// note, dismissable with the small x. Once dismissed it stays gone.
export default function GiftBanner() {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(KEY) !== "1") setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="relative -mx-1 flex items-center gap-2 rounded-full bg-blush-100/80 px-3 py-1.5 text-xs ring-1 ring-blush-200">
      <span aria-hidden>💝</span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex-1 truncate text-left text-blush-800"
      >
        Happy Mother&apos;s Day — {expanded ? "tap to collapse" : "tap to read the note"}
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="grid h-5 w-5 place-items-center rounded-full text-blush-700/70 hover:bg-white/60 hover:text-blush-700"
        onClick={() => {
          window.localStorage.setItem(KEY, "1");
          setShow(false);
        }}
      >
        ×
      </button>
      {expanded && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 rounded-2xl bg-white/95 p-4 text-sm leading-relaxed text-stone-700 shadow-card ring-1 ring-stone-100 backdrop-blur">
          I made you a little place for everything you love to wear. Snap photos of your pieces, save
          your favorites, and mix and match outfits any time. Love you.
        </div>
      )}
    </div>
  );
}
