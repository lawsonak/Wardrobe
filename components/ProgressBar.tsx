"use client";

import { cn } from "@/lib/cn";

// Tiny progress bar. `value` is 0..1; clamps out of range. Renders a
// blush fill on a stone track. When `label` is provided it sits above
// the bar.
export default function ProgressBar({
  value,
  label,
  hint,
  className,
}: {
  value: number;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  const widthPct = (pct * 100).toFixed(1);

  return (
    <div className={cn("w-full", className)}>
      {(label || hint) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          {label && <span className="text-stone-700">{label}</span>}
          {hint && <span className="text-stone-400">{hint}</span>}
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div
          className="h-full rounded-full bg-blush-500 transition-[width] duration-200 ease-out"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
