"use client";

import { cn } from "@/lib/cn";

export default function SkeletonCard({
  className,
  withCaption = false,
}: {
  className?: string;
  withCaption?: boolean;
}) {
  return (
    <div className={cn("animate-pulse", className)}>
      <div className="aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br from-blush-50 via-cream-50 to-blush-50 ring-1 ring-stone-100" />
      {withCaption && (
        <div className="mt-2 space-y-1">
          <div className="h-3 w-2/3 rounded-full bg-stone-100" />
          <div className="h-2 w-1/2 rounded-full bg-stone-100" />
        </div>
      )}
    </div>
  );
}

export function SkeletonGrid({
  count = 6,
  cols = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
}: {
  count?: number;
  cols?: string;
}) {
  return (
    <div className={cn("grid gap-3", cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
