"use client";

import { useEffect, useId, useRef, useState } from "react";
import { brandKey, findSimilar } from "@/lib/brand";

type Brand = { id: string; name: string; nameKey: string };

export default function BrandInput({
  value,
  brandId,
  onChange,
}: {
  value: string;
  brandId: string | null;
  onChange: (next: { value: string; brandId: string | null }) => void;
}) {
  const listId = useId();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [open, setOpen] = useState(false);
  const [warning, setWarning] = useState<{ name: string; key: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/brands")
      .then((r) => (r.ok ? r.json() : { brands: [] }))
      .then((d) => {
        if (alive) setBrands(d.brands ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Filter suggestions for the dropdown.
  const k = brandKey(value);
  const suggestions = !value
    ? brands.slice(0, 8)
    : brands
        .filter((b) => b.nameKey.includes(k) || b.name.toLowerCase().includes(value.toLowerCase()))
        .slice(0, 8);

  function pick(b: Brand) {
    setOpen(false);
    setWarning(null);
    onChange({ value: b.name, brandId: b.id });
  }

  function handleChange(next: string) {
    // Whenever the user types, drop the saved brandId — they're editing
    // free-form unless they pick from the dropdown again.
    onChange({ value: next, brandId: null });

    // Warn if they're about to enter something near-but-not-equal to an existing brand.
    if (next.trim().length >= 2) {
      const sim = findSimilar(next, brands.map((b) => ({ name: b.name, key: b.nameKey })));
      const isExact = brands.some((b) => b.nameKey === brandKey(next));
      setWarning(sim && !isExact ? sim : null);
    } else {
      setWarning(null);
    }
  }

  async function applySuggestion() {
    if (!warning) return;
    const found = brands.find((b) => b.nameKey === warning.key);
    if (found) pick(found);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="input"
        list={listId}
        value={value}
        placeholder="e.g. J.Crew"
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-stone-200 bg-white shadow-card">
          {suggestions.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => pick(b)}
                className={
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50 " +
                  (brandId === b.id ? "bg-blush-50" : "")
                }
              >
                <span className="truncate">{b.name}</span>
                {brandId === b.id && <span className="text-xs text-blush-600">selected</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {warning && (
        <p className="mt-1 text-xs text-amber-700">
          Did you mean{" "}
          <button type="button" onClick={applySuggestion} className="font-semibold underline">
            {warning.name}
          </button>
          ? Otherwise it&apos;ll be saved as a new brand.
        </p>
      )}
    </div>
  );
}
