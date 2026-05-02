"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, WISHLIST_PRIORITIES, type WishlistPriority } from "@/lib/constants";

type InitialValues = {
  id?: string;
  name?: string;
  category?: string | null;
  brand?: string | null;
  link?: string | null;
  price?: string | null;
  priority?: string;
  occasion?: string | null;
  notes?: string | null;
  fillsGap?: boolean;
  giftIdea?: boolean;
  imagePath?: string | null;
};

type SimilarMatch = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
  brand: string | null;
};

export default function WishlistForm({ initial }: { initial?: InitialValues }) {
  const router = useRouter();
  const isEdit = !!initial?.id;
  const imageRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [priority, setPriority] = useState<WishlistPriority>((initial?.priority as WishlistPriority) ?? "medium");
  const [occasion, setOccasion] = useState(initial?.occasion ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [fillsGap, setFillsGap] = useState(initial?.fillsGap ?? false);
  const [giftIdea, setGiftIdea] = useState(initial?.giftIdea ?? false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    initial?.imagePath ? `/api/uploads/${initial.imagePath}` : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── ✨ Auto-fill from URL or product name ──────────────────────
  // The user pastes a product link OR types "white linen blazer
  // Madewell"; Gemini's grounded search visits the page (or searches),
  // returns name/brand/category/color/link/price/description, and we
  // pre-fill the form. Non-blocking — fields the AI didn't return
  // stay whatever the user already typed.
  const [autofillQuery, setAutofillQuery] = useState("");
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  async function runAutofill() {
    const q = autofillQuery.trim();
    if (!q) {
      setAutofillError("Paste a link or type a product description first.");
      return;
    }
    setAutofillBusy(true);
    setAutofillError(null);
    try {
      const res = await fetch("/api/ai/wishlist-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setAutofillError(data.message ?? "AI auto-fill is disabled.");
        return;
      }
      if (!res.ok) {
        setAutofillError(data?.error ?? `Lookup failed (HTTP ${res.status})`);
        return;
      }
      const s = (data?.suggestions ?? {}) as {
        name?: string; brand?: string; category?: string; color?: string;
        link?: string; price?: string; description?: string;
      };
      // Only fill fields the user hasn't already filled in. The AI
      // shouldn't clobber what the user typed.
      if (s.name && !name.trim()) setName(s.name);
      if (s.brand && !brand.trim()) setBrand(s.brand);
      if (s.category && !category) setCategory(s.category);
      if (s.link && !link.trim()) setLink(s.link);
      if (s.price && !price.trim()) setPrice(s.price);
      if (s.description && !notes.trim()) setNotes(s.description);
      // No setColor / setSubType state in this form, but we surface
      // them via notes so the next "similar in closet" check picks
      // them up indirectly via category match.
    } catch (err) {
      console.error(err);
      setAutofillError(err instanceof Error ? err.message : "Couldn't reach the AI.");
    } finally {
      setAutofillBusy(false);
    }
  }

  // ── "Already in your closet?" check ────────────────────────────
  // Debounced lookup against the active closet whenever category or
  // brand changes. Pure DB query (no AI) — see /api/wishlist/similar.
  // Soft warning: shows a banner with up to 3 candidate matches and
  // a link to each, but never blocks the save.
  const [similar, setSimilar] = useState<SimilarMatch[]>([]);
  useEffect(() => {
    // Don't run on the edit form — the user already saved this row,
    // they don't need the duplicate warning every render.
    if (isEdit) return;
    if (!category && !brand) {
      setSimilar([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (brand.trim()) params.set("brand", brand.trim());
        const res = await fetch(`/api/wishlist/similar?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { matches: SimilarMatch[] };
        setSimilar(data.matches ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Non-fatal — silent on network blips
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [category, brand, isEdit]);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setError(null);
    setSubmitting(true);

    // Bare-domain input ("madewell.com/jeans") is friendlier to type
    // than a full URL — normalize to https:// before saving so the
    // stored value always parses as a real URL downstream.
    const normalizedLink = normalizeUrl(link);

    try {
      if (isEdit) {
        const res = await fetch(`/api/wishlist/${initial!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category: category || null, brand: brand || null, link: normalizedLink || null, price: price || null, priority, occasion: occasion || null, notes: notes || null, fillsGap, giftIdea }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const fd = new FormData();
        fd.append("name", name);
        if (category) fd.append("category", category);
        if (brand) fd.append("brand", brand);
        if (normalizedLink) fd.append("link", normalizedLink);
        if (price) fd.append("price", price);
        fd.append("priority", priority);
        if (occasion) fd.append("occasion", occasion);
        if (notes) fd.append("notes", notes);
        if (fillsGap) fd.append("fillsGap", "1");
        if (giftIdea) fd.append("giftIdea", "1");
        if (imageFile) fd.append("image", imageFile);

        const res = await fetch("/api/wishlist", { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
      }

      router.push("/wishlist");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!isEdit && (
        <div className="card space-y-3 p-4">
          <div>
            <label className="label">✨ Auto-fill from a link or description</label>
            <p className="mt-1 text-xs text-stone-500">
              Paste a product URL or type the brand + name. We&apos;ll pull the details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              className="input flex-1 min-w-[14rem]"
              placeholder='https://… or "white linen blazer Madewell"'
              value={autofillQuery}
              onChange={(e) => setAutofillQuery(e.target.value)}
              disabled={autofillBusy}
            />
            <button
              type="button"
              onClick={runAutofill}
              disabled={autofillBusy || !autofillQuery.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {autofillBusy ? "Looking…" : "✨ Auto-fill"}
            </button>
          </div>
          {autofillError && (
            <p className="text-xs text-blush-700">{autofillError}</p>
          )}
        </div>
      )}

      <div className="card space-y-4 p-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. White linen blazer" required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Brand</label>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Madewell" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price</label>
            <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 85" />
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as WishlistPriority)}>
              {WISHLIST_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Link</label>
          <input
            className="input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://… or madewell.com/jeans"
            // Plain text rather than type=url so HTML5's strict
            // validation doesn't reject bare domains. The form
            // normalizer below adds https:// on submit if missing.
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="label">Occasion / For what</label>
          <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="e.g. Work, Summer, Date night" />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Size needed, color preference, why you love it…" />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={fillsGap} onChange={(e) => setFillsGap(e.target.checked)} />
            Fills a wardrobe gap
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={giftIdea} onChange={(e) => setGiftIdea(e.target.checked)} />
            Gift idea
          </label>
        </div>
      </div>

      {/* "Already in your closet?" soft warning. Non-blocking — the
          user can save the wish anyway, this is just a heads-up. */}
      {!isEdit && similar.length > 0 && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">You may already own something similar</p>
          <p className="mt-1 text-xs text-amber-800">
            Tap a piece to compare before adding the wish.
          </p>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {similar.map((m) => {
              const src = m.imageBgRemovedPath
                ? `/api/uploads/${m.imageBgRemovedPath}`
                : `/api/uploads/${m.imagePath}`;
              return (
                <li key={m.id}>
                  <Link href={`/wardrobe/${m.id}`} className="block">
                    <div className="tile-bg flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white/60 p-1 ring-1 ring-amber-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full object-contain" />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-amber-900">
                      {m.subType ?? m.category}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Optional photo */}
      <div className="card p-4">
        <p className="label mb-2">Photo <span className="normal-case font-normal text-stone-400">(optional)</span></p>
        {imagePreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagePreview} alt="Preview" className="mb-3 h-32 w-auto rounded-xl object-cover ring-1 ring-stone-100" />
        )}
        <input ref={imageRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
        <button type="button" className="btn-secondary text-sm" onClick={() => imageRef.current?.click()}>
          {imagePreview ? "Change photo" : "Add photo"}
        </button>
      </div>

      {error && <p className="text-sm text-blush-700">{error}</p>}

      <div className="flex gap-2 pb-2">
        <button type="submit" className="btn-primary flex-1" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add to wishlist"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Accept bare-domain links ("madewell.com/jeans") in addition to full
// URLs. Empty/null/whitespace passes through unchanged.
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Looks like a bare domain (or domain + path)? Add https://. We don't
  // try to validate the host — the wishlist row's "link" is free-form,
  // and the AI auto-fill / browser will surface a bad value visually.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
