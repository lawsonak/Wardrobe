"use client";

import { useEffect, useState } from "react";

const KEY = "wardrobe.giftBanner.dismissed";
// Mother's Day 2026 — the dismiss × stays hidden until *after* this
// date so the recipient can't accidentally lose the note before
// reading it. Even a localStorage dismiss flag set earlier is ignored
// while the date hasn't passed.
const MOTHERS_DAY_ISO = "2026-05-10";

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Mother's Day note at the top of the dashboard. Tappable to read the
// full message. The dismiss × is hidden until the day *after* Mother's
// Day, and the banner force-shows even if dismissed earlier — the
// recipient can't accidentally lose the note before the day arrives.
export default function GiftBanner() {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(KEY) === "1";
    const past = todayISO() > MOTHERS_DAY_ISO;
    setCanDismiss(past);
    if (!dismissed || !past) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <section
      aria-label="A note from someone who loves you"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blush-100 via-blush-50 to-cream-50 p-4 ring-1 ring-blush-200"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-xl shadow-card"
        >
          💝
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg text-blush-700">Happy Mother&apos;s Day</p>
          <p className="truncate text-xs text-stone-600">
            {expanded ? "Tap to close" : "Tap to read the note"}
          </p>
        </div>
        <svg
          className={"h-5 w-5 shrink-0 text-blush-600 transition " + (expanded ? "rotate-180" : "")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 rounded-xl bg-white/85 p-4 text-sm leading-relaxed text-stone-700 ring-1 ring-stone-100">
          I made you a little place for everything you love to wear. Snap photos of your pieces,
          save your favorites, and mix and match outfits any time. Love you.
        </div>
      )}

      {canDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-blush-700/70 hover:bg-white/60 hover:text-blush-700"
          onClick={() => {
            window.localStorage.setItem(KEY, "1");
            setShow(false);
          }}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </section>
  );
}
