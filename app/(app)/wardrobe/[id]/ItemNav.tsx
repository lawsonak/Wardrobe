"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptics";

// Chevron arrows + page-wide horizontal swipe gesture for jumping to
// the previous / next item without going back to the closet first.
//
// Swipe direction follows the standard iOS convention:
//   - Swipe LEFT (drag content right-to-left)  → next item
//   - Swipe RIGHT (drag content left-to-right) → previous item
// The threshold (60px horizontal AND clearly horizontal vs. vertical)
// keeps page scrolling and pull-to-refresh untouched.
export default function ItemNav({
  prevId,
  nextId,
}: {
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!prevId && !nextId) return;

    let startX = 0;
    let startY = 0;
    let started = false;

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      started = true;
    }
    function onEnd(e: TouchEvent) {
      if (!started) return;
      started = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Need a clearly-horizontal swipe so vertical scrolls don't
      // accidentally trigger navigation.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0 && nextId) {
        haptic("selection");
        router.push(`/wardrobe/${nextId}`);
      } else if (dx > 0 && prevId) {
        haptic("selection");
        router.push(`/wardrobe/${prevId}`);
      }
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [prevId, nextId, router]);

  return (
    <div className="flex items-center gap-1">
      {prevId ? (
        <Link
          href={`/wardrobe/${prevId}`}
          className="btn-icon"
          aria-label="Previous item"
          onClick={() => haptic("selection")}
        >
          <Chevron direction="left" />
        </Link>
      ) : (
        <span className="btn-icon pointer-events-none opacity-30" aria-hidden>
          <Chevron direction="left" />
        </span>
      )}
      {nextId ? (
        <Link
          href={`/wardrobe/${nextId}`}
          className="btn-icon"
          aria-label="Next item"
          onClick={() => haptic("selection")}
        >
          <Chevron direction="right" />
        </Link>
      ) : (
        <span className="btn-icon pointer-events-none opacity-30" aria-hidden>
          <Chevron direction="right" />
        </span>
      )}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={direction === "left" ? "M15.75 19.5 8.25 12l7.5-7.5" : "m8.25 4.5 7.5 7.5-7.5 7.5"}
      />
    </svg>
  );
}
