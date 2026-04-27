"use client";

import { COLOR_PALETTE } from "@/lib/constants";
import { cn } from "@/lib/cn";

export default function ColorSwatch({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_PALETTE.map((c) => {
        const selected = value === c.name;
        const isGradient = c.hex.startsWith("linear-gradient");
        return (
          <button
            key={c.name}
            type="button"
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(selected ? null : c.name)}
            style={isGradient ? { backgroundImage: c.hex } : { backgroundColor: c.hex }}
            className={cn(
              "h-7 w-7 rounded-full ring-1 ring-stone-200 transition",
              selected && "ring-2 ring-blush-500 ring-offset-2",
            )}
          />
        );
      })}
    </div>
  );
}
