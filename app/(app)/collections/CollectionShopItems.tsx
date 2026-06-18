"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";

export type ShopItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  color: string | null;
  price: string | null;
  link: string | null;
  imagePath: string | null;
  source: string | null;
  notes: string | null;
  purchased: boolean;
  /** AI try-on render of this product on the user's mannequin. Null
   *  until the user taps "✨ Try on". Persisted server-side so other
   *  sessions / page reloads see it. */
  tryOnImagePath: string | null;
  /** Bumped on each successful render so the <img src> can append a
   *  cache-buster — the served path uses a hash-based filename but
   *  the same hash can be overwritten on regenerate, so we lean on
   *  the timestamp the same way the per-Outfit try-on page does. */
  tryOnGeneratedAt: string | null;
};

// One pasted link's progress through the import pipeline. Mirrors the
// bulk-upload queue: links are processed sequentially (one request each)
// so each server call stays short and the user watches them resolve.
type QueueRow = {
  link: string;
  state: "pending" | "working" | "done" | "error";
  error?: string;
};

// A collection's shopping list: paste product links and the server pulls
// the name / brand / price / image off each page (Open Graph + JSON-LD,
// with a Gemini grounded-search fallback for sites that block scraping —
// e.g. Amazon). Saved cards live on the collection, separate from both
// the owned-closet pieces and the global wishlist. Adds + removes persist
// immediately via their own API calls, so this section is independent of
// the collection's "Save changes" button.
//
// Controlled by the parent: the items array + setter live one level up
// (CollectionEditor or CollectionWizard) so siblings — like the AI shop
// panel — can append to the same list when their "+ Add" button fires.
// Without the lift, the AI panel would save successfully but the new
// row wouldn't appear here until a full page reload. The setter is a
// React.Dispatch (not a wrapped callback) so functional updaters like
// `setItems(prev => [...prev, x])` see the latest state across the
// sequential pasted-link loop.
export default function CollectionShopItems({
  collectionId,
  items,
  setItems,
}: {
  collectionId: string;
  items: ShopItem[];
  setItems: Dispatch<SetStateAction<ShopItem[]>>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState(false);
  // Per-item progress flags. tryOnBusy: which item ids are mid-Gemini.
  // photoBusy: which item ids are mid-upload. showProduct: which item
  // ids the user has flipped back to the original product photo (we
  // default to showing the try-on when one exists, since the user
  // just generated it).
  const [tryOnBusy, setTryOnBusy] = useState<Set<string>>(new Set());
  const [photoBusy, setPhotoBusy] = useState<Set<string>>(new Set());
  const [showProduct, setShowProduct] = useState<Set<string>>(new Set());
  // One hidden file input per card — keyed by item id at click time
  // so we can route the change event back to the right item.
  const fileInputs = useRef<Map<string, HTMLInputElement>>(new Map());

  async function pullOne(link: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/collections/${collectionId}/shop-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const data = (await res.json()) as { item?: ShopItem; error?: string };
      if (!res.ok || !data.item) {
        return { ok: false, error: data.error || `Couldn't pull that link (HTTP ${res.status}).` };
      }
      setItems((prev) => [data.item as ShopItem, ...prev]);
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't reach the server." };
    }
  }

  async function pullAll() {
    // De-dupe and clean the pasted lines. One link per line.
    const links = Array.from(
      new Set(
        draft
          .split(/[\n\r]+/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    );
    if (links.length === 0) {
      toast("Paste at least one product link.", "error");
      return;
    }

    setBusy(true);
    setQueue(links.map((link) => ({ link, state: "pending" })));
    let okCount = 0;
    const failedLinks: string[] = [];
    for (let i = 0; i < links.length; i++) {
      setQueue((prev) => prev.map((r, idx) => (idx === i ? { ...r, state: "working" } : r)));
      const result = await pullOne(links[i]);
      setQueue((prev) =>
        prev.map((r, idx) =>
          idx === i
            ? { ...r, state: result.ok ? "done" : "error", error: result.error }
            : r,
        ),
      );
      if (result.ok) okCount++;
      else failedLinks.push(links[i]);
    }
    setBusy(false);
    haptic(okCount > 0 ? "success" : "warning");
    // Re-seed the textarea with only the links that failed so the user
    // can fix and retry just those; clears entirely when all succeeded.
    setDraft(failedLinks.join("\n"));
    if (okCount > 0) {
      toast(`Pulled ${okCount} item${okCount === 1 ? "" : "s"}`);
      router.refresh();
    }
  }

  async function remove(item: ShopItem) {
    const ok = await confirmDialog({
      title: "Remove this item?",
      body: `"${item.name}" comes off this collection's shopping list.`,
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const res = await fetch(`/api/collections/${collectionId}/shop-items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      haptic("impact");
    } catch {
      // Restore on failure.
      setItems((prev) => [item, ...prev]);
      toast("Couldn't remove that item", "error");
    }
  }

  async function togglePurchased(item: ShopItem) {
    const next = !item.purchased;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, purchased: next } : i)));
    try {
      const res = await fetch(`/api/collections/${collectionId}/shop-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchased: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, purchased: !next } : i)));
      toast("Couldn't update that item", "error");
    }
  }

  // Multipart photo replace. The server runs the upload through
  // Gemini's object detection to crop out just the clothing — handy
  // when the user took an Amazon screenshot with the search bar and
  // nav chrome around the product photo. Detection-empty / AI-off
  // both fall through to the raw upload server-side.
  async function uploadPhoto(item: ShopItem, file: File) {
    setPhotoBusy((prev) => new Set(prev).add(item.id));
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(
        `/api/collections/${collectionId}/shop-items/${item.id}/photo`,
        { method: "POST", body: fd },
      );
      const data = (await res.json()) as {
        item?: ShopItem;
        detectionUsed?: boolean;
        error?: string;
      };
      if (!res.ok || !data.item) {
        toast(data.error || "Couldn't upload that photo", "error");
        return;
      }
      // Server returns the fresh row; merge into local state. Replacing
      // the photo invalidates the cached try-on render — server already
      // nulled those columns + unlinked the file.
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item as ShopItem : i)));
      // Drop the "show product" flag so when the user generates a new
      // try-on, the swap-to-try-on default still works.
      setShowProduct((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      haptic("success");
      toast(
        data.detectionUsed
          ? "Photo updated — cropped to the garment."
          : "Photo updated.",
      );
    } catch {
      toast("Couldn't reach the server", "error");
    } finally {
      setPhotoBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function pickPhoto(item: ShopItem) {
    const input = fileInputs.current.get(item.id);
    if (input) input.click();
  }

  // Server runs the per-shop-item try-on via the same Gemini pipeline
  // as the per-Outfit try-on, but with one garment as input — sidesteps
  // the 5-garment cap that a full outfit would hit. Cache-hash matches
  // mannequin id + image mtime + prompt version, so re-clicks
  // short-circuit unless something changed. The button always passes
  // ?force=1 so an explicit click always re-runs (per Outfit pattern).
  async function tryOn(item: ShopItem) {
    if (!item.imagePath) {
      toast("Add a photo first — tap 📷 Replace photo.", "error");
      return;
    }
    setTryOnBusy((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(
        `/api/collections/${collectionId}/shop-items/${item.id}/tryon?force=1`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        tryOnImagePath?: string;
        tryOnGeneratedAt?: string | null;
        error?: string;
      };
      if (!res.ok || !data.tryOnImagePath) {
        toast(data.error || "Try-on failed", "error");
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                tryOnImagePath: data.tryOnImagePath ?? null,
                tryOnGeneratedAt: data.tryOnGeneratedAt ?? new Date().toISOString(),
              }
            : i,
        ),
      );
      // Default to showing the try-on after a successful render —
      // they just asked for it.
      setShowProduct((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      haptic("success");
    } catch {
      toast("Couldn't reach the AI service", "error");
    } finally {
      setTryOnBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function toggleImage(item: ShopItem) {
    if (!item.tryOnImagePath) return;
    setShowProduct((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  const activeQueue = queue.filter((r) => r.state !== "done");

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-display text-xl text-stone-800">🛍 Shopping list</h2>
        <p className="text-sm text-stone-500">
          Paste product links (Amazon, Madewell, Sephora, …) — one per line — and we&apos;ll pull
          the name, price, and photo so you can track what you&apos;re considering for this collection.
        </p>
      </div>

      <div className="space-y-2">
        <textarea
          className="input min-h-[72px] font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"https://www.madewell.com/...\nhttps://www.amazon.com/dp/..."}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={pullAll} disabled={busy}>
            {busy ? "Pulling…" : "Pull items"}
          </button>
          <p className="text-xs text-stone-500">
            Most retailers work instantly. Some (Amazon especially) may need a second or fall back
            to AI lookup.
          </p>
        </div>
      </div>

      {activeQueue.length > 0 && (
        <ul className="space-y-1 text-xs">
          {activeQueue.map((r, idx) => (
            <li
              key={`${r.link}-${idx}`}
              className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-1.5"
            >
              <span className="shrink-0">
                {r.state === "working" ? "⏳" : r.state === "error" ? "⚠️" : "•"}
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-600">{r.link}</span>
              {r.state === "error" && (
                <span className="shrink-0 text-blush-700">{r.error ?? "Failed"}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl bg-cream-50 px-3 py-3 text-sm text-stone-500">
          No saved products yet. Paste a link above to start a shopping list for this collection.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const isTryOnBusy = tryOnBusy.has(item.id);
            const isPhotoBusy = photoBusy.has(item.id);
            const showingProduct = showProduct.has(item.id) || !item.tryOnImagePath;
            const visibleImagePath = showingProduct
              ? item.imagePath
              : item.tryOnImagePath;
            // Cache-buster keyed off generatedAt — the upload route
            // hash-suffixes filenames so the URL changes on each
            // photo replace, but the try-on route reuses the same
            // hashed filename for the same inputs, so we lean on
            // the timestamp the same way TryOnView does.
            const cacheBuster = !showingProduct && item.tryOnGeneratedAt
              ? `?t=${encodeURIComponent(item.tryOnGeneratedAt)}`
              : "";

            return (
              <li
                key={item.id}
                className={
                  "card flex gap-3 p-3 transition " + (item.purchased ? "opacity-60" : "")
                }
              >
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => toggleImage(item)}
                    disabled={!item.tryOnImagePath}
                    className={
                      "tile-bg relative flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-stone-100 " +
                      (item.tryOnImagePath ? "cursor-pointer hover:ring-blush-300" : "cursor-default")
                    }
                    title={
                      item.tryOnImagePath
                        ? showingProduct
                          ? "Show AI try-on"
                          : "Show product photo"
                        : undefined
                    }
                    aria-label={
                      showingProduct ? "Product photo" : "AI try-on"
                    }
                  >
                    {visibleImagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/uploads/${visibleImagePath}${cacheBuster}`}
                        alt={item.name}
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-2xl text-stone-300">🛍</span>
                    )}
                    {item.tryOnImagePath && !showingProduct && (
                      <span className="absolute bottom-0.5 left-0.5 rounded-full bg-blush-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                        ✨
                      </span>
                    )}
                  </button>
                  {item.tryOnImagePath && (
                    <p className="text-center text-[10px] text-stone-400">
                      tap to swap
                    </p>
                  )}
                </div>

                {/* Hidden per-item file input so the camera roll can
                    open straight from the card without a modal. */}
                <input
                  ref={(el) => {
                    if (el) fileInputs.current.set(item.id, el);
                    else fileInputs.current.delete(item.id);
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(item, f);
                    // Allow re-picking the same file later.
                    e.target.value = "";
                  }}
                />

                <div className="flex min-w-0 flex-1 flex-col">
                  <p
                    className={
                      "text-sm font-medium text-stone-800 " +
                      (item.purchased ? "line-through" : "")
                    }
                  >
                    {item.name}
                  </p>
                  <p className="truncate text-[11px] uppercase tracking-wide text-stone-400">
                    {[item.brand, item.category, item.color, item.price].filter(Boolean).join(" · ")}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs">
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blush-600 hover:underline"
                        title={item.source ?? item.link}
                      >
                        View ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => pickPhoto(item)}
                      disabled={isPhotoBusy}
                      className="text-stone-500 hover:text-stone-800 disabled:opacity-50"
                    >
                      {isPhotoBusy
                        ? "Uploading…"
                        : item.imagePath
                          ? "📷 Replace photo"
                          : "📷 Add photo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => tryOn(item)}
                      disabled={isTryOnBusy || !item.imagePath}
                      className="text-blush-600 hover:text-blush-800 disabled:opacity-50"
                      title={
                        !item.imagePath
                          ? "Add a photo first"
                          : undefined
                      }
                    >
                      {isTryOnBusy
                        ? "Generating…"
                        : item.tryOnImagePath
                          ? "✨ Regenerate try-on"
                          : "✨ Try on"}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePurchased(item)}
                      className="text-stone-500 hover:text-stone-800"
                    >
                      {item.purchased ? "↺ Mark unbought" : "✓ Bought"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="ml-auto text-stone-400 hover:text-blush-700"
                      aria-label={`Remove ${item.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
