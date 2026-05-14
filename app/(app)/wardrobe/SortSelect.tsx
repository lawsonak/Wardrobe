"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SORT_OPTIONS, type SortKey } from "@/lib/closetSort";

export default function SortSelect({ value }: { value: SortKey }) {
  const router = useRouter();
  const sp = useSearchParams();

  return (
    <label className="flex items-center gap-1 text-xs text-stone-500">
      <span className="hidden sm:inline">Sort</span>
      <select
        className="input w-auto py-1 text-xs"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString());
          // "newest" is the default — drop the param so the URL stays
          // clean for the most common case.
          if (e.target.value === "newest") next.delete("sort");
          else next.set("sort", e.target.value);
          const qs = next.toString();
          router.push(qs ? `/wardrobe?${qs}` : "/wardrobe");
        }}
        aria-label="Sort closet"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
