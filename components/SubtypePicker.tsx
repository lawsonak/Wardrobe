"use client";

import { useState } from "react";
import { SUBTYPES_BY_CATEGORY, type Category } from "@/lib/constants";
import { cn } from "@/lib/cn";

// Tap a chip to set the subType. "Other…" reveals a free-type input so the
// user can still pick anything not in the list. If the current value
// doesn't match any chip, the input is shown pre-filled.
export default function SubtypePicker({
  category,
  value,
  onChange,
}: {
  category: Category;
  value: string;
  onChange: (next: string) => void;
}) {
  const presets = SUBTYPES_BY_CATEGORY[category] ?? [];
  const isPreset = !!value && presets.some((p) => p.toLowerCase() === value.toLowerCase());
  const [showCustom, setShowCustom] = useState<boolean>(!isPreset && !!value);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = value.toLowerCase() === p.toLowerCase();
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(p);
                setShowCustom(false);
              }}
              className={cn("chip", on ? "chip-on" : "chip-off")}
            >
              {p}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setShowCustom((v) => !v);
            if (!showCustom && isPreset) onChange("");
          }}
          className={cn("chip", showCustom || (!!value && !isPreset) ? "chip-on" : "chip-off")}
        >
          Other…
        </button>
      </div>
      {(showCustom || (!!value && !isPreset)) && (
        <input
          className="input"
          placeholder="Type a custom name"
          value={isPreset ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={showCustom}
        />
      )}
    </div>
  );
}
