"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  computeBraSize,
  type MeasurementUnit,
  type Measurements,
} from "@/lib/measurements";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation } from "@/lib/imageOrientation";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/haptics";
import { fetchWithRetry, friendlyFetchError } from "@/lib/fetchRetry";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

// Guided manual entry. Core section always visible; the Bra (an
// ABraThatFits-style sub-calculator) and Extra sections are
// collapsible so the common case stays short. Nothing is required —
// the user fills what they want.

type NumStr = string; // inputs are strings; parsed to number on save

const CORE_FIELDS: Array<{
  key: keyof Measurements["core"];
  label: string;
  hint: string;
}> = [
  { key: "height", label: "Height", hint: "Standing straight, no shoes, floor to top of head." },
  { key: "bust", label: "Bust / chest", hint: "Around the fullest part, tape level all the way round." },
  { key: "waist", label: "Waist", hint: "The natural crease when you bend sideways — usually the narrowest point." },
  { key: "hips", label: "Hips", hint: "Around the fullest part of the seat, feet together." },
  { key: "shoulder", label: "Shoulder width", hint: "Across the back, bony point of one shoulder to the other." },
  { key: "sleeve", label: "Sleeve / arm length", hint: "Shoulder point, down a slightly bent arm, to the wrist bone." },
  { key: "inseam", label: "Inseam", hint: "Crotch seam straight down to where you want trousers to end." },
];

export default function MeasurementsForm({
  initial,
}: {
  initial: Measurements | null;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState<MeasurementUnit>(initial?.unit ?? "in");

  // Everything is kept as a string in state so partial input ("3"
  // mid-typing) doesn't fight a number type. Parsed on save.
  const [core, setCore] = useState<Record<string, NumStr>>(() => {
    const c = initial?.core ?? {};
    return {
      height: c.height?.toString() ?? "",
      bust: c.bust?.toString() ?? "",
      waist: c.waist?.toString() ?? "",
      hips: c.hips?.toString() ?? "",
      shoulder: c.shoulder?.toString() ?? "",
      sleeve: c.sleeve?.toString() ?? "",
      inseam: c.inseam?.toString() ?? "",
      shoeUS: c.shoeUS?.toString() ?? "",
    };
  });

  const [braOpen, setBraOpen] = useState(!!initial?.bra);
  const [bra, setBra] = useState<Record<string, NumStr>>(() => {
    const b = initial?.bra ?? {};
    return {
      underbust: b.underbust?.toString() ?? "",
      bustStanding: b.bustStanding?.toString() ?? "",
      bustLeaning: b.bustLeaning?.toString() ?? "",
      bustLying: b.bustLying?.toString() ?? "",
    };
  });
  const [braSizeOverride, setBraSizeOverride] = useState(initial?.bra?.size ?? "");

  const [extraOpen, setExtraOpen] = useState(
    !!(initial?.extra && Object.keys(initial.extra).length > 0),
  );
  const [extra, setExtra] = useState({
    neck: initial?.extra?.neck?.toString() ?? "",
    thigh: initial?.extra?.thigh?.toString() ?? "",
    weight: initial?.extra?.weight?.toString() ?? "",
    ringSize: initial?.extra?.ringSize ?? "",
    notes: initial?.extra?.notes ?? "",
  });

  const [shape, setShape] = useState(initial?.shape ?? "");

  const [saving, setSaving] = useState(false);

  // Phase E: photo estimate. Photos are sent and dropped — never
  // stored. Front required, side optional but improves accuracy.
  const frontRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateMsg, setEstimateMsg] = useState<string | null>(null);

  const lengthUnit = unit === "cm" ? "cm" : "in";
  const weightUnit = unit === "cm" ? "kg" : "lb";

  // Live ABTF-style computed size from whatever's typed so far.
  const computed = useMemo(() => {
    const n = (s: string) => {
      const v = parseFloat(s);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    return computeBraSize(
      {
        underbust: n(bra.underbust),
        bustStanding: n(bra.bustStanding),
        bustLeaning: n(bra.bustLeaning),
        bustLying: n(bra.bustLying),
      },
      unit,
    );
  }, [bra, unit]);

  const dirty =
    !saving &&
    JSON.stringify({ unit, core, bra, braSizeOverride, extra, shape }) !==
      JSON.stringify({
        unit: initial?.unit ?? "in",
        core: {
          height: initial?.core.height?.toString() ?? "",
          bust: initial?.core.bust?.toString() ?? "",
          waist: initial?.core.waist?.toString() ?? "",
          hips: initial?.core.hips?.toString() ?? "",
          shoulder: initial?.core.shoulder?.toString() ?? "",
          sleeve: initial?.core.sleeve?.toString() ?? "",
          inseam: initial?.core.inseam?.toString() ?? "",
          shoeUS: initial?.core.shoeUS?.toString() ?? "",
        },
        bra: {
          underbust: initial?.bra?.underbust?.toString() ?? "",
          bustStanding: initial?.bra?.bustStanding?.toString() ?? "",
          bustLeaning: initial?.bra?.bustLeaning?.toString() ?? "",
          bustLying: initial?.bra?.bustLying?.toString() ?? "",
        },
        braSizeOverride: initial?.bra?.size ?? "",
        extra: {
          neck: initial?.extra?.neck?.toString() ?? "",
          thigh: initial?.extra?.thigh?.toString() ?? "",
          weight: initial?.extra?.weight?.toString() ?? "",
          ringSize: initial?.extra?.ringSize ?? "",
          notes: initial?.extra?.notes ?? "",
        },
        shape: initial?.shape ?? "",
      });
  useUnsavedChanges(dirty);

  function numOrUndef(s: string): number | undefined {
    const v = parseFloat(s);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        unit,
        core: {
          height: numOrUndef(core.height),
          bust: numOrUndef(core.bust),
          waist: numOrUndef(core.waist),
          hips: numOrUndef(core.hips),
          shoulder: numOrUndef(core.shoulder),
          sleeve: numOrUndef(core.sleeve),
          inseam: numOrUndef(core.inseam),
          shoeUS: numOrUndef(core.shoeUS),
        },
        bra: {
          underbust: numOrUndef(bra.underbust),
          bustStanding: numOrUndef(bra.bustStanding),
          bustLeaning: numOrUndef(bra.bustLeaning),
          bustLying: numOrUndef(bra.bustLying),
          size: braSizeOverride.trim() || undefined,
        },
        extra: {
          neck: numOrUndef(extra.neck),
          thigh: numOrUndef(extra.thigh),
          weight: numOrUndef(extra.weight),
          ringSize: extra.ringSize.trim() || undefined,
          notes: extra.notes.trim() || undefined,
        },
        shape: shape.trim() || undefined,
      };
      const res = await fetch("/api/measurements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      haptic("success");
      toast("Measurements saved");
      router.push("/settings");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast(err instanceof Error ? err.message : "Couldn't save", "error");
      setSaving(false);
    }
  }

  // HEIC → JPEG + bake EXIF so the model sees an upright image (a
  // sideways photo would scramble the width/height it scales from).
  async function prepPhoto(f: File): Promise<File> {
    let file = f;
    if (isHeic(file)) {
      try {
        file = await heicToJpeg(file);
      } catch {
        /* fall through with the original; Gemini may still read it */
      }
    }
    try {
      file = await normalizeOrientation(file);
    } catch {
      /* non-fatal */
    }
    return file;
  }

  async function runEstimate() {
    if (estimating) return;
    if (!frontFile) {
      setEstimateMsg("Add a front photo first.");
      return;
    }
    if (!core.height.trim()) {
      setEstimateMsg("Enter your tape-measured height above — it's the scale reference.");
      return;
    }
    setEstimating(true);
    setEstimateMsg(null);
    try {
      const fd = new FormData();
      fd.append("front", await prepPhoto(frontFile));
      if (sideFile) fd.append("side", await prepPhoto(sideFile));
      fd.append("height", core.height.trim());
      fd.append("unit", unit);
      const res = await fetchWithRetry(
        "/api/ai/estimate-measurements",
        { method: "POST", body: fd },
        { timeoutMs: 95_000 },
      );
      const data = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        message?: string;
        error?: string;
        draft?: {
          bust?: number;
          waist?: number;
          hips?: number;
          shoulder?: number;
          sleeve?: number;
          inseam?: number;
          shape?: string;
          confidence?: number;
        };
      };
      if (data?.enabled === false) {
        setEstimateMsg(data.message ?? "AI is disabled.");
        return;
      }
      if (!res.ok || !data.draft) {
        setEstimateMsg(data?.error ?? "Couldn't estimate from those photos.");
        return;
      }
      const d = data.draft;
      const set = (k: keyof typeof core, v: number | undefined) => {
        if (typeof v === "number") setCore((p) => ({ ...p, [k]: String(v) }));
      };
      set("bust", d.bust);
      set("waist", d.waist);
      set("hips", d.hips);
      set("shoulder", d.shoulder);
      set("sleeve", d.sleeve);
      set("inseam", d.inseam);
      if (d.shape) setShape(d.shape);
      const pct =
        typeof d.confidence === "number" ? ` (model confidence ${Math.round(d.confidence * 100)}%)` : "";
      setEstimateMsg(
        `Draft filled in above${pct}. These are rough estimates — check each against a tape before saving.`,
      );
      haptic("success");
    } catch (err) {
      console.error(err);
      setEstimateMsg(friendlyFetchError(err, "Estimate failed."));
    } finally {
      setEstimating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Unit toggle */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-stone-500">Units</span>
        <button
          type="button"
          onClick={() => setUnit("in")}
          className={"chip " + (unit === "in" ? "chip-on" : "chip-off")}
        >
          inches
        </button>
        <button
          type="button"
          onClick={() => setUnit("cm")}
          className={"chip " + (unit === "cm" ? "chip-on" : "chip-off")}
        >
          cm
        </button>
      </div>

      {/* Phase E: photo estimate */}
      <section className="card p-4">
        <button
          type="button"
          onClick={() => setEstimateOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-display text-lg text-stone-800">
            ✨ Estimate from photos (optional)
          </span>
          <span className="text-stone-400">{estimateOpen ? "−" : "+"}</span>
        </button>
        {estimateOpen && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-stone-600">
              A rough starting point — AI reads your silhouette and fills the
              fields below for you to review. <strong>Not tailor-accurate</strong>{" "}
              (expect ±1-3 {lengthUnit}); always sanity-check against a tape.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-stone-500">
              <li>Enter your tape-measured <strong>height</strong> below first — it&apos;s the scale reference, the estimate can&apos;t run without it.</li>
              <li>Wear <strong>fitted</strong> clothing — leggings + a fitted top, activewear, or (for best accuracy, optional) underwear. Loose fabric hides the real shape.</li>
              <li>Plain wall, full body in frame head-to-toe, phone about hip height ~2-3 m away, barefoot, arms ~15° out from your sides.</li>
              <li><strong>Front photo</strong> required; a <strong>true side</strong> photo (turned 90°) noticeably improves it.</li>
              <li>Photos are sent for the estimate and <strong>not saved</strong> — they&apos;re processed and discarded.</li>
            </ul>

            <input
              ref={frontRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (e.target) e.target.value = "";
                if (f) setFrontFile(f);
              }}
            />
            <input
              ref={sideRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (e.target) e.target.value = "";
                if (f) setSideFile(f);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => frontRef.current?.click()}
              >
                {frontFile ? "✓ Front photo" : "Front photo"}
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => sideRef.current?.click()}
              >
                {sideFile ? "✓ Side photo" : "Side photo (optional)"}
              </button>
              <button
                type="button"
                className="btn-primary text-xs disabled:opacity-50"
                disabled={estimating || !frontFile}
                onClick={runEstimate}
              >
                {estimating ? "Estimating…" : "✨ Estimate"}
              </button>
            </div>
            {estimateMsg && (
              <p className="rounded-lg bg-blush-50 px-3 py-2 text-xs text-blush-800 ring-1 ring-blush-200">
                {estimateMsg}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Core */}
      <section className="card space-y-3 p-4">
        <h2 className="font-display text-lg text-stone-800">Core</h2>
        {CORE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="label">
              {f.label} <span className="font-normal text-stone-400">({lengthUnit})</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              className="input"
              value={core[f.key] ?? ""}
              onChange={(e) => setCore((p) => ({ ...p, [f.key]: e.target.value }))}
            />
            <span className="mt-0.5 block text-xs text-stone-500">{f.hint}</span>
          </label>
        ))}
        <label className="block">
          <span className="label">US shoe size</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            className="input"
            value={core.shoeUS ?? ""}
            onChange={(e) => setCore((p) => ({ ...p, shoeUS: e.target.value }))}
          />
        </label>
      </section>

      {/* Shape / style descriptor — free text, fed into the
          shopping + mannequin AI prompts. Seeded by the photo
          estimate but always editable. */}
      <section className="card space-y-2 p-4">
        <h2 className="font-display text-lg text-stone-800">Shape &amp; style notes</h2>
        <p className="text-xs text-stone-500">
          A short description of your silhouette and proportions — where
          volume sits, waist definition, torso/leg balance. Used to sharpen
          AI shopping picks and the try-on figure. Edit freely; the photo
          estimate above can fill this in for you.
        </p>
        <textarea
          className="input min-h-[64px]"
          placeholder="e.g. defined waist, volume at hips, slightly long torso, broad shoulders"
          value={shape}
          maxLength={240}
          onChange={(e) => setShape(e.target.value)}
        />
      </section>

      {/* Bra (ABTF-style) */}
      <section className="card p-4">
        <button
          type="button"
          onClick={() => setBraOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-display text-lg text-stone-800">Bra size (optional)</span>
          <span className="text-stone-400">{braOpen ? "−" : "+"}</span>
        </button>
        {braOpen && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-stone-500">
              The r/ABraThatFits method. Measure with a soft tape, snug but not
              tight. The size below is computed live — adjust it if you already
              know yours runs different.
            </p>
            <label className="block">
              <span className="label">
                Underbust — snug{" "}
                <span className="font-normal text-stone-400">({lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={bra.underbust ?? ""}
                onChange={(e) => setBra((p) => ({ ...p, underbust: e.target.value }))}
              />
              <span className="mt-0.5 block text-xs text-stone-500">
                Directly under the bust, firm. This sets the band.
              </span>
            </label>
            <label className="block">
              <span className="label">
                Bust — standing{" "}
                <span className="font-normal text-stone-400">({lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={bra.bustStanding ?? ""}
                onChange={(e) => setBra((p) => ({ ...p, bustStanding: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">
                Bust — leaning forward 90°{" "}
                <span className="font-normal text-stone-400">(optional, {lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={bra.bustLeaning ?? ""}
                onChange={(e) => setBra((p) => ({ ...p, bustLeaning: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">
                Bust — lying on back{" "}
                <span className="font-normal text-stone-400">(optional, {lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={bra.bustLying ?? ""}
                onChange={(e) => setBra((p) => ({ ...p, bustLying: e.target.value }))}
              />
            </label>
            <div className="rounded-lg bg-blush-50 p-3 text-sm ring-1 ring-blush-200">
              <span className="text-stone-600">Computed size: </span>
              <span className="font-medium text-blush-800">
                {computed ?? "— fill underbust + a bust measurement"}
              </span>
            </div>
            <label className="block">
              <span className="label">Use this size (override)</span>
              <input
                type="text"
                className="input"
                placeholder={computed ?? "e.g. 34D"}
                value={braSizeOverride}
                onChange={(e) => setBraSizeOverride(e.target.value)}
              />
              <span className="mt-0.5 block text-xs text-stone-500">
                Leave blank to use the computed size.
              </span>
            </label>
          </div>
        )}
      </section>

      {/* Extra */}
      <section className="card p-4">
        <button
          type="button"
          onClick={() => setExtraOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-display text-lg text-stone-800">More (optional)</span>
          <span className="text-stone-400">{extraOpen ? "−" : "+"}</span>
        </button>
        {extraOpen && (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="label">
                Neck <span className="font-normal text-stone-400">({lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={extra.neck}
                onChange={(e) => setExtra((p) => ({ ...p, neck: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">
                Thigh <span className="font-normal text-stone-400">({lengthUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={extra.thigh}
                onChange={(e) => setExtra((p) => ({ ...p, thigh: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">
                Weight <span className="font-normal text-stone-400">({weightUnit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                className="input"
                value={extra.weight}
                onChange={(e) => setExtra((p) => ({ ...p, weight: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">US ring size</span>
              <input
                type="text"
                className="input"
                placeholder="e.g. 6.5"
                value={extra.ringSize}
                onChange={(e) => setExtra((p) => ({ ...p, ringSize: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">Notes</span>
              <textarea
                className="input min-h-[64px]"
                placeholder="Anything else worth remembering — e.g. broad shoulders, long torso, prefer high-rise."
                value={extra.notes}
                onChange={(e) => setExtra((p) => ({ ...p, notes: e.target.value }))}
              />
            </label>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2 pb-4">
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save measurements"}
        </button>
      </div>
    </div>
  );
}
