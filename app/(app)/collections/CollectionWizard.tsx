"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ACTIVITIES, CATEGORIES, SEASONS, type Category } from "@/lib/constants";
import { cn } from "@/lib/cn";
import {
  computePackingTargets,
  fillMissingCategories,
  totalCount,
  type PackingTargets,
} from "@/lib/packingTargets";
import ItemPicker, { type Selectable } from "./ItemPicker";

type Kind = "trip" | "general";
type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: "Trip" },
  { n: 2, label: "Activities" },
  { n: 3, label: "Quantities" },
  { n: 4, label: "Packing list" },
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
  const [occasion, setOccasion] = useState("");
  const [season, setSeason] = useState("");

  // Step 2
  const [activities, setActivities] = useState<string[]>([]);
  const [activityDraft, setActivityDraft] = useState("");
  const [suggestingActs, setSuggestingActs] = useState(false);
  const [actsAiHint, setActsAiHint] = useState<string | null>(null);

  // Step 3 (Quantities). `targets` is initialized from a deterministic
  // formula on first entry; the user can adjust each row with +/-.
  // `targetsTouched` keeps a manual change from being clobbered by an
  // auto-recompute when the user goes back and edits dates/activities.
  const [targets, setTargets] = useState<PackingTargets>(() =>
    fillMissingCategories(computePackingTargets(null, [])),
  );
  const [targetsTouched, setTargetsTouched] = useState(false);

  // Step 4
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [packingNotes, setPackingNotes] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genHint, setGenHint] = useState<string | null>(null);
  const [tripNotes, setTripNotes] = useState("");

  const [step, setStep] = useState<Step>(1);
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

  // Recompute target defaults from nights + activities until the user
  // makes a manual edit. After that, leave their picks alone.
  useEffect(() => {
    if (targetsTouched) return;
    setTargets(fillMissingCategories(computePackingTargets(nights, activities)));
  }, [nights, activities, targetsTouched]);

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

  function bumpTarget(c: Category, delta: number) {
    setTargetsTouched(true);
    setTargets((prev) => {
      const cur = prev[c] ?? 0;
      const next = Math.max(0, Math.min(50, cur + delta));
      return { ...prev, [c]: next };
    });
  }

  function resetTargets() {
    setTargetsTouched(false);
    setTargets(fillMissingCategories(computePackingTargets(nights, activities)));
  }

  async function generatePackingList() {
    setGenerating(true);
    setGenHint(null);
    setError(null);
    try {
      const cleanTargets: Record<string, number> = {};
      for (const c of CATEGORIES) {
        const n = targets[c] ?? 0;
        if (n > 0) cleanTargets[c] = n;
      }
      const res = await fetch("/api/ai/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...aiPayload,
          activities,
          targets: cleanTargets,
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
  const targetTotal = totalCount(targets);
  const canSave = canAdvance1 && selectedItems.length > 0;

  // The Quantities step explains *why* each count was picked. These
  // tooltips live next to each row.
  const targetReason: Partial<Record<Category, string>> = useMemo(() => {
    const days = nights == null ? null : Math.max(1, nights);
    const reasons: Partial<Record<Category, string>> = {};
    if (days != null) {
      reasons.Underwear = `${days} day${days === 1 ? "" : "s"} + 1 spare`;
      reasons["Socks & Hosiery"] = `${days} day${days === 1 ? "" : "s"} + 1 spare`;
      reasons.Bras = `1 per ~2 days`;
      reasons.Tops = `with some rewearing`;
      reasons.Bottoms = `bottoms rewear easily`;
    }
    if (activities.some((a) => /workout|gym|hik|run|yoga/i.test(a))) {
      reasons.Activewear = `for workouts`;
    }
    if (activities.some((a) => /beach|swim|pool/i.test(a))) {
      reasons.Swimwear = `for the beach / pool`;
    }
    if (activities.some((a) => /formal|date|wedding|dinner/i.test(a))) {
      reasons.Dresses = `for formal nights`;
    }
    return reasons;
  }, [nights, activities]);

  return (
    <div className="space-y-5 pb-24">
      {/* Quick header so the user always knows what they're building. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stepper step={step} onJump={(s) => s < step && setStep(s)} />
      </div>

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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={suggestActivities}
              disabled={suggestingActs}
            >
              {suggestingActs ? "Asking AI…" : "✨ Suggest with AI"}
            </button>
            {actsAiHint && <span className="text-xs text-stone-500">{actsAiHint}</span>}
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
          </div>

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>
              Next: Quantities
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-xl text-stone-800">How much of each?</h2>
              <p className="text-sm text-stone-500">
                {nights != null
                  ? `For ${nights} night${nights === 1 ? "" : "s"}, here's what we recommend. Bump anything up or down.`
                  : "Suggested counts. Bump anything up or down."}
              </p>
            </div>
            {targetsTouched && (
              <button type="button" className="btn-ghost text-blush-600 text-xs" onClick={resetTargets}>
                ↺ Reset to recommended
              </button>
            )}
          </div>

          <ul className="divide-y divide-stone-100">
            {CATEGORIES.map((c) => {
              const n = targets[c] ?? 0;
              const reason = targetReason[c];
              return (
                <li key={c} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className={cn("text-sm", n > 0 ? "text-stone-800" : "text-stone-400")}>{c}</p>
                    {n > 0 && reason && <p className="text-[11px] text-stone-400">{reason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => bumpTarget(c, -1)}
                      disabled={n <= 0}
                      className="grid h-7 w-7 place-items-center rounded-full border border-stone-200 text-stone-600 transition hover:bg-stone-50 disabled:opacity-30"
                      aria-label={`Decrease ${c}`}
                    >
                      −
                    </button>
                    <span className={cn("min-w-[1.5rem] text-center text-sm tabular-nums", n > 0 ? "font-semibold text-stone-800" : "text-stone-400")}>
                      {n}
                    </span>
                    <button
                      type="button"
                      onClick={() => bumpTarget(c, 1)}
                      className="grid h-7 w-7 place-items-center rounded-full border border-stone-200 text-stone-600 transition hover:bg-stone-50"
                      aria-label={`Increase ${c}`}
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-stone-500">
            Total: <span className="font-semibold text-stone-700">{targetTotal}</span> piece{targetTotal === 1 ? "" : "s"}
          </p>

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              ← Back
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(4)}>
              Next: Packing list
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {/* Compact summary so the user knows what they're packing for. */}
          <div className="card p-3 text-xs text-stone-600">
            <span className="font-medium text-stone-800">{name || "Untitled"}</span>
            {kind === "trip" && (destination || nights != null) && (
              <>
                {" · "}
                {destination || "?"}
                {nights != null ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}
              </>
            )}
            {activities.length > 0 && (
              <>
                {" · "}
                {activities.slice(0, 3).map(capitalize).join(", ")}
                {activities.length > 3 ? "…" : ""}
              </>
            )}
          </div>

          {/* Action bar at the top so Save is reachable without scrolling
              past the packing list. Mirrors the bottom bar's controls. */}
          <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <button type="button" className="btn-ghost" onClick={() => setStep(3)}>
              ← Back
            </button>
            <div className="flex items-center gap-2">
              <Link href="/collections" className="btn-ghost text-stone-500">
                Cancel
              </Link>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={busy || !canSave}
                title={!canSave ? "Pick at least one piece" : undefined}
              >
                {busy ? "Saving…" : "Save collection"}
              </button>
            </div>
          </div>

          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-xl text-stone-800">Packing list</h2>
                <p className="text-sm text-stone-500">
                  AI picks specific pieces from your closet to match the quantities you set.
                </p>
              </div>
              <button
                type="button"
                className={generated ? "btn-secondary" : "btn-primary"}
                onClick={generatePackingList}
                disabled={generating}
              >
                {generating ? "Curating…" : generated ? "✨ Regenerate" : "✨ Generate packing list"}
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
                {targetTotal > 0 ? ` of ${targetTotal} target` : ""}
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

          <div className="card p-4">
            <label className="label">Trip notes (optional)</label>
            <textarea
              className="input min-h-[60px]"
              value={tripNotes}
              onChange={(e) => setTripNotes(e.target.value)}
              placeholder="Anything you want to remember while packing"
            />
          </div>

          {error && <p className="text-sm text-blush-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  return (
    <ol className="flex flex-1 items-center gap-2 text-xs">
      {STEPS.map((s, idx) => {
        const isPast = step > s.n;
        const isCurrent = step === s.n;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => isPast && onJump(s.n as Step)}
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
