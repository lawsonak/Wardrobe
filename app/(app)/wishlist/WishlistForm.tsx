"use client";

import { useRef, useState } from "react";
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

    try {
      if (isEdit) {
        const res = await fetch(`/api/wishlist/${initial!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category: category || null, brand: brand || null, link: link || null, price: price || null, priority, occasion: occasion || null, notes: notes || null, fillsGap, giftIdea }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const fd = new FormData();
        fd.append("name", name);
        if (category) fd.append("category", category);
        if (brand) fd.append("brand", brand);
        if (link) fd.append("link", link);
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
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" type="url" />
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
