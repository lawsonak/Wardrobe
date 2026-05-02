"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

// Sits at the top of /wardrobe. The user can type plain English ("white
// summer dresses for a beach trip") and we POST to /api/ai/search to
// convert it into URL filters this page already understands.
//
// When AI is off we just fall back to the existing q= LIKE-search.
export default function SmartSearchBar({
  initialQuery = "",
  hasItems,
}: {
  initialQuery?: string;
  hasItems: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (!text) {
      navigateTo({});
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        // AI off — just LIKE-search the raw query.
        navigateTo({ q: text });
        toast("AI search is off — searching by keyword", "info");
        return;
      }
      const f = (data?.filters ?? {}) as {
        category?: string;
        color?: string;
        season?: string;
        activity?: string;
        favoritesOnly?: boolean;
        freeText?: string;
      };
      const params: Record<string, string> = {};
      if (f.category) params.category = f.category;
      if (f.color) params.color = f.color;
      if (f.season) params.season = f.season;
      if (f.activity) params.activity = f.activity;
      if (f.favoritesOnly) params.fav = "1";
      // Always carry the original prose through as `q` (preferring the
      // AI's extracted freeText when it gave us a tighter substring).
      // The wardrobe page's loose-match fallback drops `q` first if
      // the strict combo returns 0 hits, so keeping it here doesn't
      // over-narrow — but it ensures the notes column is searched
      // every run, even when the AI also extracted a category or
      // color filter. Previously `q` was only set if the AI itself
      // returned a freeText slice, which meant prose like "soft
      // cotton" got lost the moment it picked up "cotton" → category=
      // Tops or similar.
      params.q = (f.freeText && f.freeText.trim()) ? f.freeText.trim() : text;
      navigateTo(params);
    } catch (err) {
      console.error(err);
      toast("Search failed — try keyword search", "error");
      navigateTo({ q: text });
    } finally {
      setBusy(false);
    }
  }

  function navigateTo(params: Record<string, string>) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) u.set(k, v);
    const target = u.toString() ? `/wardrobe?${u.toString()}` : "/wardrobe";
    startTransition(() => router.push(target));
  }

  function clearAll() {
    setQuery("");
    startTransition(() => router.push("/wardrobe"));
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" role="search">
      <div className="relative flex-1 min-w-[14rem]">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
        </svg>
        <input
          aria-label="Search closet"
          className="input pl-9"
          placeholder={hasItems ? 'Try "summer dresses I haven\'t worn"' : "Search…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={busy || pending}>
        {busy || pending ? "Looking…" : "✨ Search"}
      </button>
      {(initialQuery || query) && (
        <button type="button" onClick={clearAll} className="btn-ghost text-stone-500">
          Clear
        </button>
      )}
    </form>
  );
}
