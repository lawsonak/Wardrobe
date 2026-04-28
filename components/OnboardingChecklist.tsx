"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "wardrobe.onboarding.dismissed";

export type OnboardingProgress = {
  hasItem: boolean;
  hasFavorite: boolean;
  hasOutfit: boolean;
  hasWishlist: boolean;
};

type Step = {
  key: keyof OnboardingProgress | "install";
  title: string;
  body: string;
  href: string;
  cta: string;
  done: (p: OnboardingProgress, installed: boolean) => boolean;
};

const STEPS: Step[] = [
  {
    key: "hasItem",
    title: "Add your first piece",
    body: "Snap a photo of any item you own. Tags can wait.",
    href: "/wardrobe/new",
    cta: "Add an item",
    done: (p) => p.hasItem,
  },
  {
    key: "hasFavorite",
    title: "Mark a favorite",
    body: "Tap the heart on a piece you love.",
    href: "/wardrobe",
    cta: "Open closet",
    done: (p) => p.hasFavorite,
  },
  {
    key: "hasOutfit",
    title: "Build your first outfit",
    body: "Mix and match a few pieces and save the look.",
    href: "/outfits/builder",
    cta: "Build an outfit",
    done: (p) => p.hasOutfit,
  },
  {
    key: "hasWishlist",
    title: "Start a wishlist",
    body: "Save things you'd love next: birthday, vacation, anything.",
    href: "/wishlist/new",
    cta: "Add a wish",
    done: (p) => p.hasWishlist,
  },
  {
    key: "install",
    title: "Install on iPhone",
    body: "Open in Safari → Share → Add to Home Screen for the full app feel.",
    href: "#",
    cta: "Got it",
    done: (_p, installed) => installed,
  },
];

export default function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      // @ts-expect-error iOS Safari quirk
      window.navigator.standalone === true;
    setInstalled(!!standalone);
  }, []);

  const completed = STEPS.filter((s) => s.done(progress, installed)).length;
  const total = STEPS.length;
  const allDone = completed >= total;

  if (dismissed || allDone) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <div>
          <p className="font-display text-lg text-stone-800">Get started</p>
          <p className="text-xs text-stone-500">{completed} of {total} done</p>
        </div>
        <button
          type="button"
          aria-label="Hide checklist"
          className="text-stone-400 hover:text-stone-700"
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, "1");
            setDismissed(true);
          }}
        >
          Hide
        </button>
      </div>
      <ol className="divide-y divide-stone-100">
        {STEPS.map((step) => {
          const done = step.done(progress, installed);
          return (
            <li key={step.key} className="flex items-center gap-3 px-4 py-3">
              <span
                className={
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold " +
                  (done ? "bg-sage-400 text-white" : "bg-stone-100 text-stone-500")
                }
                aria-hidden
              >
                {done ? "✓" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <p className={"text-sm font-medium " + (done ? "text-stone-400 line-through" : "text-stone-800")}>
                  {step.title}
                </p>
                {!done && <p className="text-xs text-stone-500">{step.body}</p>}
              </div>
              {!done && step.href !== "#" && (
                <Link href={step.href} className="btn-secondary text-xs">{step.cta}</Link>
              )}
              {!done && step.key === "install" && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setInstalled(true)}
                >
                  {step.cta}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
