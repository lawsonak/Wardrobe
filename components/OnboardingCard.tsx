"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const KEY = "wardrobe.onboarding.dismissed";

const STEPS = [
  {
    icon: "📷",
    title: "Add your first item",
    desc: "Take a photo of a piece you love. Brand, size, and notes are all optional.",
    href: "/wardrobe/new",
    cta: "Add an item",
  },
  {
    icon: "💝",
    title: "Save a wish",
    desc: "Add something you're looking for or love the idea of.",
    href: "/wishlist/new",
    cta: "Add to wishlist",
  },
  {
    icon: "✨",
    title: "Build an outfit",
    desc: "Mix and match your pieces to save a look.",
    href: "/outfits/builder",
    cta: "Build an outfit",
  },
  {
    icon: "📱",
    title: "Install on iPhone",
    desc: 'Tap Share → "Add to Home Screen" in Safari for a full-screen app feel.',
    href: null,
    cta: null,
  },
];

export default function OnboardingCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(KEY) !== "1") setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    window.localStorage.setItem(KEY, "1");
    setShow(false);
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <p className="font-display text-lg text-blush-700">Get started</p>
        <button
          type="button"
          onClick={dismiss}
          className="grid h-6 w-6 place-items-center rounded-full bg-stone-100 text-xs text-stone-500 hover:bg-stone-200"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="divide-y divide-stone-50">
        {STEPS.map((step) => (
          <div key={step.title} className="flex items-start gap-3 px-4 py-3">
            <span className="text-xl leading-none mt-0.5">{step.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-stone-800 text-sm">{step.title}</p>
              <p className="text-xs text-stone-500 mt-0.5">{step.desc}</p>
            </div>
            {step.href && step.cta && (
              <Link href={step.href} className="btn-secondary text-xs shrink-0" onClick={dismiss}>
                {step.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
