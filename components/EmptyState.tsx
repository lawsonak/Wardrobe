import Link from "next/link";

// Shared empty-state card for index pages (closet, outfits, looks,
// collections, wishlist, sets, beauty). Standardizes the warm tone the
// dashboard and Outfits page already use so the experience doesn't
// flip between "Build your first look, Eryn." (warm) and
// "No looks yet." (barren) depending on which page the user lands on.
//
// Props are intentionally minimal: a leading emoji, a personalized
// headline, a one-line hint, and 1-2 CTAs. Anything more belongs in a
// custom render, not here.
export default function EmptyState({
  emoji,
  headline,
  hint,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  emoji?: string;
  headline: string;
  hint?: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="card p-10 text-center">
      {emoji && <p className="text-3xl" aria-hidden>{emoji}</p>}
      <p className="mt-2 font-display text-2xl text-blush-700">{headline}</p>
      {hint && <p className="mt-1 text-stone-600">{hint}</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={primaryHref} className="btn-primary">
          {primaryLabel}
        </Link>
        {secondaryHref && secondaryLabel && (
          <Link href={secondaryHref} className="btn-secondary">
            {secondaryLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
