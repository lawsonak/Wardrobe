"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type CarouselPhoto = {
  id: string;
  src: string;
  label: string | null;
};

// Instagram-style swipe carousel with dot indicators. CSS scroll-snap
// handles the swipe gesture natively (works on touch + trackpad +
// keyboard arrows). Dots can be tapped to jump to a slide.
//
// Single-photo case bypasses the carousel chrome entirely.
export default function ItemPhotoCarousel({
  photos,
  alt,
}: {
  photos: CarouselPhoto[];
  alt: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || photos.length <= 1) return;
    let raf = 0;
    function update() {
      if (!el) return;
      // Round to the nearest slide based on scrollLeft / slide width.
      const w = el.clientWidth;
      if (w === 0) return;
      const i = Math.round(el.scrollLeft / w);
      setIndex(Math.max(0, Math.min(photos.length - 1, i)));
    }
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [photos.length]);

  function jumpTo(i: number) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  if (photos.length === 0) return null;

  if (photos.length === 1) {
    const only = photos[0];
    return (
      <div className="tile-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={only.src}
          alt={only.label ?? alt}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        className="no-scrollbar flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-2xl"
      >
        {photos.map((p) => (
          <div
            key={p.id}
            className="tile-bg flex aspect-square w-full shrink-0 snap-center items-center justify-center p-6"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.src}
              alt={p.label ?? alt}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5" aria-hidden>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            aria-label={`Photo ${i + 1} of ${photos.length}`}
            onClick={() => jumpTo(i)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-5 bg-blush-500" : "w-1.5 bg-stone-300 hover:bg-stone-400",
            )}
          />
        ))}
      </div>
      {photos[index]?.label && (
        <p className="text-center text-xs text-stone-500">{photos[index].label}</p>
      )}
    </div>
  );
}
