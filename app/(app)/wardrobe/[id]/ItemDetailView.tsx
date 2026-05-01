import { Fragment } from "react";
import Link from "next/link";
import { csvToList } from "@/lib/constants";
import { parseFitDetails, FIT_FIELDS } from "@/lib/fitDetails";
import type { Category } from "@/lib/constants";
import { FavoriteToggle, DeleteItemButton } from "./ItemActions";
import ItemNav from "./ItemNav";
import { type Angle } from "./ItemAngles";
import ItemPhotoCarousel, { type CarouselPhoto } from "@/components/ItemPhotoCarousel";
import SetLink from "./SetLink";

type DetailItem = {
  id: string;
  imagePath: string;
  imageBgRemovedPath: string | null;
  labelImagePath: string | null;
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
  status: string;
};

type DetailOutfit = {
  id: string;
  name: string;
  thumbs: Array<{ id: string; src: string }>;
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  needs_review: "Needs review",
  draft: "Draft",
};

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
  setId,
  setName,
  sisters,
  candidates,
  prevId,
  nextId,
}: {
  item: DetailItem;
  outfits: DetailOutfit[];
  angles: Angle[];
  setId: string | null;
  setName: string | null;
  sisters: Sister[];
  candidates: Candidate[];
  prevId: string | null;
  nextId: string | null;
}) {
  const src = item.imageBgRemovedPath
    ? `/api/uploads/${item.imageBgRemovedPath}`
    : `/api/uploads/${item.imagePath}`;
  const labelSrc = item.labelImagePath ? `/api/uploads/${item.labelImagePath}` : null;

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
  // raw upload when no bg-removed variant exists.
  const photos: CarouselPhoto[] = [
    { id: "main", src, label: null },
    ...angles.map((a) => ({
      id: a.id,
      src: a.imageBgRemovedPath
        ? `/api/uploads/${a.imageBgRemovedPath}`
        : `/api/uploads/${a.imagePath}`,
      label: a.label,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">
          ← Back to closet
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
      <ItemPhotoCarousel photos={photos} alt={heading} />

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
            {item.color && (
              <span className="rounded-full bg-cream-100 px-2 py-0.5 capitalize text-stone-600">
                {item.color}
              </span>
            )}
          </div>
        </div>
        <FavoriteToggle itemId={item.id} initial={item.isFavorite} />
      </div>

      {/* Metadata grid */}
      <section className="card p-4">
        <p className="label mb-2">Details</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
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
        </dl>
        {!item.brand && !item.size && !item.color && visibleFitDetails.length === 0 && !item.fitNotes && (
          <p className="text-sm text-stone-500">No details yet — tap Edit to fill them in.</p>
        )}
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

      {/* Label / tag photo (if any) */}
      {labelSrc && (
        <section>
          <p className="label mb-1">Label / tag photo</p>
          <div className="overflow-hidden rounded-xl ring-1 ring-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={labelSrc}
              alt="Label tag"
              className="max-h-72 w-full bg-cream-50 object-contain p-2"
            />
          </div>
        </section>
      )}

      {/* Danger zone */}
      <div className="border-t border-stone-100 pt-3 text-center">
        <DeleteItemButton itemId={item.id} label={`"${heading}"`} />
      </div>
    </div>
  );
}
