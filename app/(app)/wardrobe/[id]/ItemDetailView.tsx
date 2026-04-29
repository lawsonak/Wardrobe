import { Fragment } from "react";
import Link from "next/link";
import { csvToList } from "@/lib/constants";
import { parseFitDetails, FIT_FIELDS } from "@/lib/fitDetails";
import {
  daysSince,
  lastWearISO,
  notesWithoutWears,
  wearCount,
  wearDates,
} from "@/lib/wear";
import type { Category } from "@/lib/constants";
import { FavoriteToggle, WoreTodayButton, DeleteItemButton } from "./ItemActions";

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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatLastWorn(iso: string | null): string {
  if (!iso) return "Not worn yet";
  const d = daysSince(iso);
  if (d === 0) return "Worn today";
  if (d === 1) return "Worn yesterday";
  if (d < 30) return `Worn ${d} days ago`;
  if (d < 365) return `Worn ${Math.round(d / 30)} mo ago`;
  return `Worn ${Math.round(d / 365)} yr ago`;
}

export default function ItemDetailView({
  item,
  outfits,
}: {
  item: DetailItem;
  outfits: DetailOutfit[];
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

  const cleanNotes = notesWithoutWears(item.notes);
  const lastWorn = lastWearISO(item.notes);
  const totalWears = wearCount(item.notes);
  const recentWears = wearDates(item.notes).slice(0, 8);

  const heading = item.subType ?? item.category;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">
          ← Back to closet
        </Link>
        <Link
          href={`/wardrobe/${item.id}?edit=1`}
          className="btn-secondary text-xs"
          aria-label="Edit this item"
        >
          ✎ Edit
        </Link>
      </div>

      {/* Hero photo */}
      <div className="tile-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={heading} className="h-full w-full object-contain" />
      </div>

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

      {/* Quick stats */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="text-sm text-stone-700">
          <span className="font-display text-xl text-blush-700">{totalWears}</span>
          <span className="ml-1 text-stone-500">wear{totalWears === 1 ? "" : "s"}</span>
          <span className="mx-2 text-stone-300">·</span>
          <span className="text-stone-600">{formatLastWorn(lastWorn)}</span>
        </div>
        <WoreTodayButton itemId={item.id} />
      </section>

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

      {/* Notes */}
      {cleanNotes && (
        <section className="card p-4">
          <p className="label mb-2">Notes</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {cleanNotes}
          </p>
        </section>
      )}

      {/* Outfits using this item */}
      {outfits.length > 0 && (
        <section>
          <div className="mb-2 flex items-end justify-between">
            <h2 className="font-display text-xl text-stone-800">In outfits</h2>
            <Link href="/outfits" className="text-xs text-blush-600 hover:underline">
              All outfits
            </Link>
          </div>
          <ul className="space-y-2">
            {outfits.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/outfits/${o.id}/style`}
                  className="card flex items-center gap-3 p-3 transition hover:shadow-md"
                >
                  <div className="flex shrink-0 gap-1">
                    {o.thumbs.slice(0, 4).map((t) => (
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
                    <p className="truncate font-medium text-stone-800">{o.name}</p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wear history */}
      {recentWears.length > 0 && (
        <section className="card p-4">
          <p className="label mb-2">Recent wears</p>
          <p className="text-sm text-stone-700">
            {recentWears.map(formatDate).join(" · ")}
          </p>
        </section>
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
