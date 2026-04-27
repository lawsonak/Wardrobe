"use client";

import { cn } from "@/lib/cn";

export default function TagChips({
  options,
  values,
  onChange,
  format,
}: {
  options: readonly string[];
  values: string[];
  onChange: (next: string[]) => void;
  format?: (v: string) => string;
}) {
  const set = new Set(values);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = set.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => {
              const next = new Set(values);
              if (on) next.delete(opt);
              else next.add(opt);
              onChange([...next]);
            }}
            className={cn("chip", on ? "chip-on" : "chip-off")}
          >
            {format ? format(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}
