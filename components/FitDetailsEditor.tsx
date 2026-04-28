"use client";

import { useState } from "react";
import { FIT_FIELDS } from "@/lib/fitDetails";
import type { Category } from "@/lib/constants";

export default function FitDetailsEditor({
  category,
  values,
  onChange,
  notes,
  onNotesChange,
  defaultOpen = false,
}: {
  category: Category;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  notes: string;
  onNotesChange: (next: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fields = FIT_FIELDS[category] ?? [];
  const filledCount = Object.values(values).filter((v) => v && v.trim()).length;

  return (
    <div className="rounded-xl ring-1 ring-stone-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="text-sm font-medium text-stone-700">Fit details</p>
          <p className="text-xs text-stone-500">
            {fields.length === 0
              ? "No template for this category — use notes."
              : filledCount > 0
                ? `${filledCount} measurement${filledCount === 1 ? "" : "s"} saved`
                : "Bust, waist, inseam, and so on. Optional."}
          </p>
        </div>
        <span className="text-stone-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-3 py-3">
          {fields.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="label">{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
                  <input
                    className="input"
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      onChange({ ...values, [f.key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <label className="block">
            <span className="label">Fit notes</span>
            <textarea
              className="input min-h-[64px]"
              placeholder="e.g. runs small, stretchy, true to size"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
