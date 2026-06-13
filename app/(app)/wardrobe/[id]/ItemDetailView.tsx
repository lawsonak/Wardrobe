import { Fragment } from "react";
import Link from "next/link";
import { csvToList } from "@/lib/constants";
import { parseFitDetails, FIT_FIELDS } from "@/lib/fitDetails";
import type { FitAssessment } from "@/lib/measurements";
import type { Category } from "@/lib/constants";
import { FavoriteToggle, DeleteItemButton } from "./ItemActions";
import ItemNav from "./ItemNav";
import { type Angle } from "./ItemAngles";
import PhotoCarouselClient, { type RawPhoto } from "./PhotoCarouselClient";
import ItemLabels, { type Label } from "./ItemLabels";
import TryOnButton from "./TryOnButton";
import SetLink from "./SetLink";

type DetailItem = {
  id: string;
  imagePath: string;
  imageOriginalPath: string | null;
  imageBgRemovedPath: string | null;
  imageBgRemovedOriginalPath: string | null;
  category: string;
  subType: string | null;
  color: string | null;
  brand: string | null;
  size: string | null;
  fitDetails: string | null;
  fitNotes: string | null;
  notes: string | null;
  seasons: string;
  activities: string;
  isFavorite: boolean;
  isBackroom: boolean;
  isBeauty: boolean;
  shadeName: string | null;
  shadeHex: string | null;
  finish: string | null;
  status: string;
  /** ISO-formatted timestamps from Prisma. Serialized as strings
   *  because Server Component → Client Component prop bridges can't
   *  carry Date instances. */
  createdAt: string;
  updatedAt: string;
};

type DetailOutfit = {
  id: string;
  name: string;
  thumbs: Array<{ id: string; src: string }>;
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  draft: "Draft",
};

// Render an ISO timestamp as "May 14, 2026" for the Details card.
// Server-side render so the user sees the same value as the page
// owner — no client-locale flicker.
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return DATE_FORMAT.format(d);
}

const OUTFITS_VISIBLE_BY_DEFAULT = 10;

// Heavy-rotation staples can land in dozens of outfits — render the
// first 10 inline and tuck the rest behind a native `<details>` so the
// page doesn't become a wall of cards. No client JS needed.
function OutfitsList({ outfits }: { outfits: DetailOutfit[] }) {
  const visible = outfits.slice(0, OUTFITS_VISIBLE_BY_DEFAULT);
  const overflow = outfits.slice(OUTFITS_VISIBLE_BY_DEFAULT);
  return (
    <section>
      <div className="mb-2 flex items-end justify-between">
        <h2 className="font-display text-xl text-stone-800">
          In outfits
          <span className="ml-2 text-sm font-normal text-stone-400">{outfits.length}</span>
        </h2>
        <Link href="/outfits" className="text-xs text-blush-600 hover:underline">
          All outfits
        </Link>
      </div>
      <ul className="space-y-2">
        {visible.map((o) => (
          <OutfitListRow key={o.id} outfit={o} />
        ))}
      </ul>
      {overflow.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer rounded-full px-3 py-2 text-xs font-medium text-blush-600 hover:bg-blush-50">
            Show {overflow.length} more
          </summary>
          <ul className="mt-2 space-y-2">
            {overflow.map((o) => (
              <OutfitListRow key={o.id} outfit={o} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function OutfitListRow({ outfit }: { outfit: DetailOutfit }) {
  return (
    <li>
      <Link
        href={`/outfits/${outfit.id}/style`}
        className="card flex items-center gap-3 p-3 transition hover:shadow-md"
      >
        <div className="flex shrink-0 gap-1">
          {outfit.thumbs.slice(0, 4).map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.id}
              src={t.src}
              alt=""
              className="h-10 w-10 rounded-md bg-cream-50 object-contain p-1 ring-1 ring-stone-100"
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-stone-800">{outfit.name}</p>
        </div>
        <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </Link>
    </li>
  );
}

// Strip any legacy `[Worn: YYYY-MM-DD]` markers left over from the
// old wear-tracking feature so they don't show in the notes pane.
function stripWearMarkers(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/^[\t ]*\[Worn:\s*\d{4}-\d{2}-\d{2}\][\t ]*\r?\n?/gm, "")
    .replace(/[\t ]*\[Worn:\s*\d{4}-\d{2}-\d{2}\]/g, "")
    .trim();
}

type Sister = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
};

type Candidate = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  category: string;
  subType: string | null;
  brand: string | null;
};

export default function ItemDetailView({
  item,
  outfits,
  angles,
  labels,
  setId,
  setName,
  sisters,
  candidates,
  prevId,
  nextId,
  fit,
}: {
  item: DetailItem;
  outfits: DetailOutfit[];
  angles: Angle[];
  labels: Label[];
  setId: string | null;
  setName: string | null;
  sisters: Sister[];
  candidates: Candidate[];
  prevId: string | null;
  nextId: string | null;
  /** Advisory body-vs-garment fit hint. Null when the user has no
   *  measurements, the item has no comparable fitDetails, or it's a
   *  beauty item. Computed server-side in the page. */
  fit: FitAssessment | null;
}) {
  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
  // Lightbox always pulls the untouched original when we have one; the
  // bg-removed cutout (and the older display variant on legacy items)
  // is fine for grids but loses real detail when zoomed.
  // Lightbox preference order (best first):
  //   1. imageBgRemovedOriginalPath — full-res cutout from the
  //      server-side worker. Prefer this so the user gets a clean
  //      garment-only zoom (no floor / wall distractions) at real
  //      pixel detail. Null until the post-upload worker finishes,
  //      so a brand-new item falls through to the original.
  //   2. imageOriginalPath — full-res, *with* background. The
  //      "preserved exactly as uploaded" tier kept around for cases
  //      where the bg-removal mask isn't right.
  //   3. imagePath — display variant. Last-resort for legacy items
  //      that pre-date two-tier storage.
  const zoomSrc = item.imageBgRemovedOriginalPath
    ? `/api/uploads/${item.imageBgRemovedOriginalPath}`
    : item.imageOriginalPath
      ? `/api/uploads/${item.imageOriginalPath}`
      : `/api/uploads/${item.imagePath}`;

  const seasons = csvToList(item.seasons);
  const activities = csvToList(item.activities);
  const fitDetails = parseFitDetails(item.fitDetails);
  const fitFields = FIT_FIELDS[item.category as Category] ?? [];
  const visibleFitDetails = fitFields
    .map((f) => ({ ...f, value: fitDetails[f.key] }))
    .filter((f) => !!f.value);

  const cleanNotes = stripWearMarkers(item.notes);

  const heading = item.subType ?? item.category;

  // Hero + extra angles, combined into a single Instagram-style swipe
  // carousel. Main photo always renders first; angles fall back to the
  // raw upload when no bg-removed variant exists. The `kind` field
  // tells the client wrapper which API to hit when the user rotates
  // a slide from inside the lightbox.
  const photos: RawPhoto[] = [
    { id: "main", src, zoomSrc, label: null, kind: "hero" },
    ...angles.map<RawPhoto>((a) => ({
      id: a.id,
      angleId: a.id,
      kind: "angle",
      src: a.imageBgRemovedPath
        ? `/api/uploads/${a.imageBgRemovedPath}`
        : `/api/uploads/${a.imagePath}`,
      zoomSrc: a.imageOriginalPath
        ? `/api/uploads/${a.imageOriginalPath}`
        : `/api/uploads/${a.imagePath}`,
      label: a.label,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        {/* Back-link routes to whichever closet the item belongs to,
            so a user browsing 💄 / 🌶 stays inside it instead of
            being yanked to the main /wardrobe page. Beauty wins
            when an item is both — matches the form's "beauty wins"
            rule (since shade / finish are the more constraining
            attribute set). */}
        <Link
          href={
            item.isBeauty
              ? "/wardrobe/beauty"
              : item.isBackroom
                ? "/wardrobe/backroom"
                : "/wardrobe"
          }
          className="text-sm text-blush-600 hover:underline"
        >
          ← Back to {item.isBeauty ? "💄" : item.isBackroom ? "🌶" : "closet"}
        </Link>
        <div className="flex items-center gap-2">
          <ItemNav prevId={prevId} nextId={nextId} />
          <Link
            href={`/wardrobe/${item.id}?edit=1`}
            className="btn-secondary text-xs"
            aria-label="Edit this item"
          >
            ✎ Edit
          </Link>
        </div>
      </div>

      {/* Hero + angles in a single swipeable carousel with dot pager */}
      <PhotoCarouselClient itemId={item.id} photos={photos} alt={heading} />

      {/* Title bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl text-stone-800">{heading}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-blush-100 px-2 py-0.5 text-blush-700">
              {item.category}
            </span>
            {item.status !== "active" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                {STATUS_LABELS[item.status] ?? item.status}
              </span>
            )}
            {item.isBeauty && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
                💄 Beauty
              </span>
            )}
            {item.isBackroom && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
                🌶 Spicy
              </span>
            )}
            {item.color && (
              <span className="rounded-full bg-cream-100 px-2 py-0.5 capitalize text-stone-600">
                {item.color}
              </span>
            )}
            {/* Beauty-specific chips: shade swatch + name, finish.
                Only render for beauty items so clothing pills aren't
                cluttered with empty slots. */}
            {item.isBeauty && item.shadeName && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
                {item.shadeHex && (
                  <span
                    className="h-3 w-3 rounded-full ring-1 ring-stone-300"
                    style={{ backgroundColor: item.shadeHex }}
                    aria-hidden
                  />
                )}
                {item.shadeName}
              </span>
            )}
            {item.isBeauty && item.finish && (
              <span className="rounded-full bg-cream-100 px-2 py-0.5 capitalize text-stone-600">
                {item.finish}
              </span>
            )}
          </div>
        </div>
        <FavoriteToggle itemId={item.id} initial={item.isFavorite} />
      </div>

      {/* Advisory fit hint vs the user's saved measurements. Soft
          copy on purpose — it compares the numbers as recorded, and
          people log either size-chart or flat-lay values. */}
      {fit && (
        <div
          className={
            "flex flex-wrap items-baseline gap-2 rounded-xl px-3 py-2 text-sm ring-1 " +
            (fit.verdict === "snug"
              ? "bg-amber-50 text-amber-800 ring-amber-200"
              : fit.verdict === "roomy"
                ? "bg-sky-50 text-sky-800 ring-sky-200"
                : "bg-sage-50 text-sage-800 ring-sage-200")
          }
          title={fit.reasons
            .map(
              (r) =>
                `${r.label}: garment ${r.garmentIn}in vs you ${r.bodyIn}in (${r.deltaIn >= 0 ? "+" : ""}${r.deltaIn}in)`,
            )
            .join("\n")}
        >
          {/* Pill verdict so the read-from-distance hierarchy is
              clear (Snug / Roomy / Good fit), then the explanation. */}
          <span
            className={
              "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide " +
              (fit.verdict === "snug"
                ? "bg-amber-100 text-amber-900"
                : fit.verdict === "roomy"
                  ? "bg-sky-100 text-sky-900"
                  : "bg-sage-200 text-sage-800")
            }
          >
            {fit.verdict === "snug" ? "Snug" : fit.verdict === "roomy" ? "Roomy" : "Good fit"}
          </span>
          <span className="font-medium">{fit.headline}</span>
          <span className="text-xs opacity-80">
            — based on your measurements vs this item&rsquo;s recorded fit. A
            rough guide, not a guarantee.
          </span>
        </div>
      )}

      {/* One-click try-on: AI builds an outfit anchored on this item
          and the next page renders the mannequin composite on mount.
          Hidden for beauty items — try-on doesn't apply to a
          standalone lipstick. (PR D introduces a Look-driven try-on
          companion concept.) */}
      {!item.isBeauty && (
        <div className="flex flex-wrap items-center gap-2">
          <TryOnButton itemId={item.id} />
          {/* Manual builder entry pre-seeded with this item — closes
              the "what do I do with this piece I just added?" loop
              without making the user navigate to /outfits and search
              for the piece by name. */}
          <Link
            href={`/outfits/builder?ids=${item.id}`}
            className="btn-secondary text-xs"
          >
            ➕ Add to a new outfit
          </Link>
        </div>
      )}

      {/* Metadata grid — every field the edit form exposes, rendered
          read-only here so the user can see the full picture without
          leaving the page. Empty fields are omitted to keep the list
          terse; the "tap Edit to fill them in" hint surfaces only
          when the whole block is empty. */}
      <section className="card p-4">
        <p className="label mb-2">Details</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">Category</dt>
          <dd className="font-medium text-stone-800">{item.category}</dd>
          {item.subType && (
            <>
              <dt className="text-stone-500">Type</dt>
              <dd className="font-medium text-stone-800">{item.subType}</dd>
            </>
          )}
          {item.brand && (
            <>
              <dt className="text-stone-500">Brand</dt>
              <dd className="font-medium text-stone-800">{item.brand}</dd>
            </>
          )}
          {item.size && (
            <>
              <dt className="text-stone-500">Size</dt>
              <dd className="font-medium text-stone-800">{item.size}</dd>
            </>
          )}
          {item.color && (
            <>
              <dt className="text-stone-500">Color</dt>
              <dd className="font-medium capitalize text-stone-800">{item.color}</dd>
            </>
          )}
          {/* Beauty trio. Shade name + swatch are the most useful at
              a glance (already in the title pills) but repeated here
              so the Details card stands on its own as a complete
              read-only record of the row. */}
          {item.isBeauty && item.shadeName && (
            <>
              <dt className="text-stone-500">Shade</dt>
              <dd className="inline-flex items-center gap-2 font-medium text-stone-800">
                {item.shadeHex && (
                  <span
                    className="h-3 w-3 rounded-full ring-1 ring-stone-300"
                    style={{ backgroundColor: item.shadeHex }}
                    aria-hidden
                  />
                )}
                {item.shadeName}
                {item.shadeHex && (
                  <span className="text-xs font-normal uppercase text-stone-400">
                    {item.shadeHex}
                  </span>
                )}
              </dd>
            </>
          )}
          {item.isBeauty && !item.shadeName && item.shadeHex && (
            <>
              <dt className="text-stone-500">Shade</dt>
              <dd className="inline-flex items-center gap-2 font-medium text-stone-800">
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-stone-300"
                  style={{ backgroundColor: item.shadeHex }}
                  aria-hidden
                />
                <span className="text-xs uppercase text-stone-500">{item.shadeHex}</span>
              </dd>
            </>
          )}
          {item.isBeauty && item.finish && (
            <>
              <dt className="text-stone-500">Finish</dt>
              <dd className="font-medium capitalize text-stone-800">{item.finish}</dd>
            </>
          )}
          {visibleFitDetails.map((f) => (
            <Fragment key={f.key}>
              <dt className="text-stone-500">{f.label}</dt>
              <dd className="font-medium text-stone-800">
                {f.value}{f.unit ? ` ${f.unit}` : ""}
              </dd>
            </Fragment>
          ))}
          {item.fitNotes && (
            <>
              <dt className="text-stone-500">Fit notes</dt>
              <dd className="font-medium text-stone-800">{item.fitNotes}</dd>
            </>
          )}
          <dt className="text-stone-500">Added</dt>
          <dd className="text-stone-700">{formatDate(item.createdAt)}</dd>
          {item.updatedAt !== item.createdAt && (
            <>
              <dt className="text-stone-500">Updated</dt>
              <dd className="text-stone-700">{formatDate(item.updatedAt)}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Tag chips */}
      {(seasons.length > 0 || activities.length > 0) && (
        <section className="space-y-2">
          {seasons.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-stone-500">Seasons</span>
              {seasons.map((s) => (
                <span key={s} className="chip chip-off capitalize">
                  {s}
                </span>
              ))}
            </div>
          )}
          {activities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-stone-500">Activities</span>
              {activities.map((a) => (
                <span key={a} className="chip chip-off capitalize">
                  {a}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Matching set */}
      <SetLink
        itemId={item.id}
        setId={setId}
        setName={setName}
        sisters={sisters}
        candidates={candidates}
      />

      {/* Notes */}
      {cleanNotes && (
        <section className="card p-4">
          <p className="label mb-2">Notes</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {cleanNotes}
          </p>
        </section>
      )}

      {/* Outfits using this item — capped so heavily-used staples
          don't render an unbounded wall of cards. */}
      {outfits.length > 0 && (
        <OutfitsList outfits={outfits} />
      )}

      {/* Label / tag photos (if any). Tap any to open the lightbox;
          rotate buttons land in the lightbox toolbar. Read-only here
          — the edit page handles add / delete. */}
      {labels.length > 0 && (
        <section>
          <p className="label mb-2">
            Label{labels.length === 1 ? "" : "s"} / tag{labels.length === 1 ? "" : "s"}
          </p>
          <ItemLabels itemId={item.id} labels={labels} />
        </section>
      )}

      {/* Danger zone */}
      <div className="border-t border-stone-100 pt-3 text-center">
        <DeleteItemButton itemId={item.id} label={`"${heading}"`} />
      </div>
    </div>
  );
}
