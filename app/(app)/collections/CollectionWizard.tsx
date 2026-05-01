"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ACTIVITIES, SEASONS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import ItemPicker, { type Selectable } from "./ItemPicker";

type Kind = "trip" | "general";

const STEPS = [
  { n: 1, label: "Trip" },
  { n: 2, label: "Activities" },
  { n: 3, label: "Packing list" },
  { n: 4, label: "Review" },
] as const;

export default function CollectionWizard({ items }: { items: Selectable[] }) {
  const router = useRouter();
  const itemsById = useMemo(() => {
    const m = new Map<string, Selectable>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  // Step 1
  const [kind, setKind] = useState<Kind>("trip");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  // Legacy fields used only when kind === "general"
  const [occasion, setOccasion] = useState("");
  const [season, setSeason] = useState("");

  // Step 2
  const [activities, setActivities] = useState<string[]>([]);
  const [activityDraft, setActivityDraft] = useState("");
  const [suggestingActs, setSuggestingActs] = useState(false);
  const [actsAiHint, setActsAiHint] = useState<string | null>(null);

  // Step 3
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [packingNotes, setPackingNotes] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genHint, setGenHint] = useState<string | null>(null);

  // Step 4
  const [tripNotes, setTripNotes] = useState("");

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest a name from destination + dates so the user doesn't
  // have to think about it. Only overrides until they edit it once.
  useEffect(() => {
    if (nameTouched) return;
    if (kind !== "trip") return;
    const auto = autoName(destination, startDate, endDate);
    if (auto) setName(auto);
  }, [destination, startDate, endDate, kind, nameTouched]);

  const nights = useMemo(() => tripNights(startDate, endDate), [startDate, endDate]);
  const inferredSeason = useMemo(() => seasonFromDate(startDate), [startDate]);

  const canAdvance1 = name.trim().length > 0;
  const aiPayload = {
    destination: destination.trim() || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    occasion: occasion.trim() || undefined,
  };

  function toggleActivity(a: string) {
    setActivities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  function addCustomActivity() {
    const v = activityDraft.trim();
    if (!v) return;
    if (!activities.includes(v)) setActivities((p) => [...p, v]);
    setActivityDraft("");
  }

  async function suggestActivities() {
    setSuggestingActs(true);
    setActsAiHint(null);
    try {
      const res = await fetch("/api/ai/suggest-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiPayload),
      });
      const d = (await res.json()) as { enabled?: boolean; activities?: string[]; message?: string };
      if (!d.enabled) {
        setActsAiHint(d.message ?? "AI is disabled.");
        return;
      }
      const incoming = (d.activities ?? []).map((s) => s.trim()).filter(Boolean);
      setActivities((prev) => {
        const set = new Set(prev);
        for (const a of incoming) set.add(a);
        return [...set];
      });
    } catch {
      setActsAiHint("Couldn't reach the AI service.");
    } finally {
      setSuggestingActs(false);
    }
  }

  async function generatePackingList() {
    setGenerating(true);
    setGenHint(null);
    setError(null);
    try {
      const res = await fetch("/api/ai/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...aiPayload,
          activities,
        }),
      });
      const d = (await res.json()) as {
        enabled?: boolean;
        itemIds?: string[];
        reasoning?: string;
        packingNotes?: string;
        message?: string;
      };
      if (!d.enabled) {
        setGenHint(d.message ?? "AI is disabled.");
        return;
      }
      const ids = d.itemIds ?? [];
      setSelected(new Set(ids));
      setReasoning(d.reasoning ?? null);
      setPackingNotes(d.packingNotes ?? null);
      setGenerated(true);
      if (ids.length === 0) {
        setGenHint(d.message ?? "AI returned no picks. Try adding pieces manually.");
      }
    } catch {
      setGenHint("Couldn't reach the AI service.");
    } finally {
      setGenerating(false);
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the collection a name first.");
      setStep(1);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          destination: kind === "trip" ? destination : undefined,
          startDate: kind === "trip" ? startDate || undefined : undefined,
          endDate: kind === "trip" ? endDate || undefined : undefined,
          occasion: kind === "general" ? occasion : undefined,
          season: kind === "general" ? season : kind === "trip" ? inferredSeason : undefined,
          activities,
          notes: tripNotes,
          itemIds: [...selected],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as { collection?: { id: string } };
      router.push(d.collection?.id ? `/collections/${d.collection.id}` : "/collections");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Couldn't save the collection.");
      setBusy(false);
    }
  }

  const selectedItems = [...selected]
    .map((id) => itemsById.get(id))
    .filter((it): it is Selectable => !!it);
  const categoriesCovered = new Set(selectedItems.map((it) => it.category)).size;

  return (
    <div className="space-y-5">
      <Stepper step={step} onJump={(s) => s < step && setStep(s)} />

      {step === 1 && (
        <div className="card space-y-4 p-4">
          <div>
            <span className="label">What kind of collection?</span>
            <div className="mt-1 flex gap-2">
              <KindToggle current={kind} value="trip" label="✈️ Trip" onPick={setKind} />
              <KindToggle current={kind} value="general" label="🧺 General set" onPick={setKind} />
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {kind === "trip"
                ? "We'll ask for destination + dates and let AI pull a packing list from your closet."
                : "A themed bundle — date night, work week, weekend uniform — without trip details."}
            </p>
          </div>

          {kind === "trip" ? (
            <>
              <div>
                <label className="label">Where are you going?</label>
                <input
                  className="input"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Lisbon, Portugal"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start</label>
                  <input
                    className="input"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">End</label>
                  <input
                    className="input"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || undefined}
                  />
                </div>
              </div>
              {(nights !== null || inferredSeason) && (
                <p className="text-xs text-stone-500">
                  {nights !== null ? `${nights} night${nights === 1 ? "" : "s"}` : ""}
                  {nights !== null && inferredSeason ? " · " : ""}
                  {inferredSeason ? capitalize(inferredSeason) : ""}
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Occasion</label>
                <input
                  className="input"
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  placeholder="e.g. Date night, Work week"
                />
              </div>
              <div>
                <label className="label">Season</label>
                <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
                  <option value="">Any</option>
                  {SEASONS.map((s) => (
                    <option key={s} value={s}>{capitalize(s)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder={kind === "trip" ? "Lisbon · May 5–10" : "Date night"}
            />
          </div>

          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={!canAdvance1} onClick={() => setStep(2)}>
              Next: Activities
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-4 p-4">
          <div>
            <h2 className="font-display text-xl text-stone-800">What will you be doing?</h2>
            <p className="text-sm text-stone-500">
              Pick a few — or have AI suggest options based on your trip. The packing list pulls from these.
            </p>
          </div>

          <div>
            <span className="label">Common activities</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ACTIVITIES.map((a) => (
                <Chip key={a} label={capitalize(a)} on={activities.includes(a)} onClick={() => toggleActivity(a)} />
              ))}
            </div>
          </div>

          <div>
            <span className="label">More from this trip</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activities
                .filter((a) => !ACTIVITIES.includes(a as never))
                .map((a) => (
                  <Chip key={a} label={a} on onClick={() => toggleActivity(a)} />
                ))}
              {activities.filter((a) => !ACTIVITIES.includes(a as never)).length === 0 && (
                <span className="text-xs text-stone-400">— none yet —</span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                value={activityDraft}
                onChange={(e) => setActivityDraft(e.target.value)}
                placeholder="Add custom (e.g. wine tasting)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomActivity();
                  }
                }}
              />
              <button type="button" className="btn-secondary" onClick={addCustomActivity}>
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-ghost text-blush-600"
                onClick={suggestActivities}
                disabled={suggestingActs}
              >
                {suggestingActs ? "Asking AI…" : "✨ Suggest with AI"}
              </button>
              {actsAiHint && <span className="text-xs text-stone-500">{actsAiHint}</span>}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              ← Back
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost text-stone-500" onClick={() => setStep(3)}>
                Skip — let AI decide
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                Next: Packing list
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-xl text-stone-800">AI packing list</h2>
                <p className="text-sm text-stone-500">
                  Pulled from your wardrobe based on{" "}
                  {kind === "trip" && destination ? <strong>{destination}</strong> : "this trip"}
                  {nights !== null ? `, ${nights} night${nights === 1 ? "" : "s"}` : ""}
                  {activities.length > 0 ? `, for ${activities.slice(0, 3).join(", ")}${activities.length > 3 ? "…" : ""}` : ""}.
                </p>
              </div>
              <button
                type="button"
                className={generated ? "btn-secondary" : "btn-primary"}
                onClick={generatePackingList}
                disabled={generating}
              >
                {generating ? "Curating…" : generated ? "🔄 Regenerate" : "✨ Generate packing list"}
              </button>
            </div>

            {reasoning && (
              <p className="rounded-2xl bg-cream-50 px-3 py-2 text-sm text-stone-700">{reasoning}</p>
            )}
            {packingNotes && (
              <p className="rounded-2xl bg-blush-50 px-3 py-2 text-sm text-blush-800">💡 {packingNotes}</p>
            )}
            {genHint && <p className="text-sm text-blush-700">{genHint}</p>}

            {generating ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className="aspect-square animate-pulse rounded-2xl bg-stone-100" />
                ))}
              </ul>
            ) : selectedItems.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-stone-500">
                {generated ? "No items picked yet — try regenerating or add pieces manually." : "Tap Generate to start."}
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {selectedItems.map((it) => {
                  const src = it.imageBgRemovedPath
                    ? `/api/uploads/${it.imageBgRemovedPath}`
                    : `/api/uploads/${it.imagePath}`;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(it.id)}
                        className="tile-bg group relative block aspect-square w-full overflow-hidden rounded-2xl ring-2 ring-blush-500"
                        title="Remove from packing list"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={it.subType ?? it.category} className="h-full w-full object-contain p-2" />
                        <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-stone-800/80 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
                          ×
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
              <span>
                {selectedItems.length} piece{selectedItems.length === 1 ? "" : "s"}
                {categoriesCovered > 0 ? ` · ${categoriesCovered} categor${categoriesCovered === 1 ? "y" : "ies"} covered` : ""}
              </span>
              <button
                type="button"
                className="btn-ghost text-blush-600"
                onClick={() => setPickerOpen((v) => !v)}
              >
                {pickerOpen ? "Hide manual picker" : "+ Add more pieces"}
              </button>
            </div>
          </div>

          {pickerOpen && (
            <div className="card p-3">
              <ItemPicker items={items} selected={selected} onToggle={toggleItem} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              ← Back
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(4)}>
              Next: Review
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <h2 className="font-display text-xl text-stone-800">Review &amp; save</h2>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
              <dt className="text-stone-500">Name</dt>
              <dd className="col-span-2 text-stone-800">{name}</dd>
              {kind === "trip" && (
                <>
                  <dt className="text-stone-500">Destination</dt>
                  <dd className="col-span-2 text-stone-800">{destination || "—"}</dd>
                  <dt className="text-stone-500">Dates</dt>
                  <dd className="col-span-2 text-stone-800">
                    {startDate || endDate ? `${startDate || "?"} → ${endDate || "?"}` : "—"}
                    {nights !== null ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}
                  </dd>
                </>
              )}
              {kind === "general" && (occasion || season) && (
                <>
                  <dt className="text-stone-500">Vibe</dt>
                  <dd className="col-span-2 text-stone-800">
                    {[occasion, season ? capitalize(season) : ""].filter(Boolean).join(" · ")}
                  </dd>
                </>
              )}
              <dt className="text-stone-500">Activities</dt>
              <dd className="col-span-2 text-stone-800">
                {activities.length > 0 ? activities.map(capitalize).join(", ") : "—"}
              </dd>
              <dt className="text-stone-500">Pieces</dt>
              <dd className="col-span-2 text-stone-800">{selectedItems.length}</dd>
            </dl>

            <div>
              <label className="label">Trip notes (optional)</label>
              <textarea
                className="input min-h-[60px]"
                value={tripNotes}
                onChange={(e) => setTripNotes(e.target.value)}
                placeholder="Anything you want to remember while packing"
              />
            </div>
          </div>

          {selectedItems.length > 0 && (
            <div className="card p-3">
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {selectedItems.map((it) => {
                  const src = it.imageBgRemovedPath
                    ? `/api/uploads/${it.imageBgRemovedPath}`
                    : `/api/uploads/${it.imagePath}`;
                  return (
                    <li key={it.id} className="tile-bg flex aspect-square items-center justify-center rounded-2xl ring-1 ring-stone-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={it.subType ?? it.category} className="h-full w-full object-contain p-2" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-blush-700">{error}</p>}

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(3)}>
              ← Back
            </button>
            <div className="flex gap-2">
              <Link href="/collections" className="btn-secondary">Cancel</Link>
              <button type="button" className="btn-primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save collection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step, onJump }: { step: 1 | 2 | 3 | 4; onJump: (s: 1 | 2 | 3 | 4) => void }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, idx) => {
        const isPast = step > s.n;
        const isCurrent = step === s.n;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => isPast && onJump(s.n as 1 | 2 | 3 | 4)}
              disabled={!isPast}
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full font-semibold transition",
                isCurrent && "bg-blush-500 text-white",
                isPast && "bg-blush-200 text-blush-800 hover:bg-blush-300",
                !isCurrent && !isPast && "bg-stone-100 text-stone-400",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              {s.n}
            </button>
            <span className={cn("hidden sm:inline", isCurrent ? "text-stone-800" : "text-stone-400")}>{s.label}</span>
            {idx < STEPS.length - 1 && <span className="h-px flex-1 bg-stone-200" />}
          </li>
        );
      })}
    </ol>
  );
}

function KindToggle({
  current,
  value,
  label,
  onPick,
}: {
  current: Kind;
  value: Kind;
  label: string;
  onPick: (k: Kind) => void;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition",
        on ? "border-blush-500 bg-blush-50 text-blush-800" : "border-stone-200 text-stone-600 hover:border-stone-300",
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition",
        on ? "border-blush-500 bg-blush-50 text-blush-800" : "border-stone-200 text-stone-600 hover:border-stone-300",
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function tripNights(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

function seasonFromDate(start: string): string {
  if (!start) return "";
  const d = new Date(start);
  if (!Number.isFinite(d.getTime())) return "";
  const m = d.getUTCMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

function autoName(destination: string, start: string, end: string): string {
  const dest = destination.trim();
  if (!dest && !start) return "";
  if (!start) return dest;
  const s = new Date(start);
  if (!Number.isFinite(s.getTime())) return dest;
  const monthShort = s.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const sd = s.getUTCDate();
  if (end) {
    const e = new Date(end);
    if (Number.isFinite(e.getTime())) {
      const ed = e.getUTCDate();
      const sameMonth = e.getUTCMonth() === s.getUTCMonth() && e.getUTCFullYear() === s.getUTCFullYear();
      const range = sameMonth ? `${monthShort} ${sd}–${ed}` : `${monthShort} ${sd} → ${e.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${ed}`;
      return dest ? `${dest} · ${range}` : range;
    }
  }
  return dest ? `${dest} · ${monthShort} ${sd}` : `${monthShort} ${sd}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
