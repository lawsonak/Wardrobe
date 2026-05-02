"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, type Category } from "@/lib/constants";
import { heicToJpeg, isHeic } from "@/lib/heic";
import { normalizeOrientation } from "@/lib/imageOrientation";
import ProgressBar from "@/components/ProgressBar";
import { cn } from "@/lib/cn";

// Sentinel for the "Let AI decide" option. The bulk endpoint accepts
// this and stores a placeholder category until AI tagging fills the
// real one in.
const AUTO_CATEGORY = "__auto__" as const;
type DefaultCategory = Category | typeof AUTO_CATEGORY;

type Step = 1 | 2 | 3;
type Phase = "idle" | "uploading" | "done";

type Job = {
  id: string;             // local id while queued
  itemId?: string;        // server id once uploaded
  file: File;             // possibly HEIC-converted file we send to server
  previewUrl: string;
  state:
    | "queued"
    | "processing-heic"
    | "uploading"
    | "uploaded"
    | "error";
  error?: string;
};

let nextId = 1;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Choose" },
  { n: 2, label: "Process" },
  { n: 3, label: "Done" },
];

// Three-step wizard:
//   1. Choose & configure — pick photos, set defaults (category, status,
//      AI on/off + confidence, bg removal on/off). Continue starts the
//      pipeline.
//   2. Processing — uploads run sequentially (one POST per file to dodge
//      body-size limits), AI tagging dispatches server-side after all
//      uploads complete (fire-and-forget — runs even after the tab
//      closes), bg removal then runs client-side over the uploaded items.
//      Auto-advances to step 3 when all jobs are terminal.
//   3. Done — summary counts + next-step links. AI-still-running banner
//      stays visible while server work continues.
export default function BulkUpload() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [defaultCategory, setDefaultCategory] = useState<DefaultCategory>(AUTO_CATEGORY);
  const [defaultStatus, setDefaultStatus] = useState<"needs_review" | "active">("needs_review");
  const [removeBg, setRemoveBg] = useState(true);
  const [aiTag, setAiTag] = useState(true);
  const [promoteAtConfidence, setPromoteAtConfidence] = useState(0.85);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [aiBanner, setAiBanner] = useState<string | null>(null);
  const [bgBanner, setBgBanner] = useState<string | null>(null);
  // Set when the user taps Cancel on step 2. The pipeline checks this
  // between each photo and stops cleanly without aborting whatever's
  // currently in flight (we don't want to leave half-written files).
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const j of jobs) {
        if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance from step 2 → step 3 once every job has reached a
  // terminal state. With server-side bg removal, "uploaded" is now
  // terminal — the model runs in the background on the server and
  // the user can leave the wizard the moment uploads finish.
  useEffect(() => {
    if (step !== 2) return;
    if (jobs.length === 0) return;
    const allTerminal = jobs.every((j) => j.state === "uploaded" || j.state === "error");
    if (allTerminal && phase !== "uploading") {
      setStep(3);
      setPhase("done");
    }
  }, [jobs, step, phase]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (e.target) e.target.value = "";
    if (files.length === 0) return;

    const next: Job[] = [];
    for (const f of files) {
      next.push({
        id: `j${nextId++}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        state: "queued",
      });
    }
    setJobs((prev) => [...prev, ...next]);
  }

  function update(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  function remove(id: string) {
    setJobs((prev) => {
      const j = prev.find((x) => x.id === id);
      if (j && j.previewUrl) URL.revokeObjectURL(j.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  // Continue from step 1: kick off the whole pipeline, transition to
  // step 2 immediately so the user sees progress.
  //
  // Order of operations:
  //   1. Sequential per-file uploads (upload phase has its own progress
  //      bar). HEIC convert + EXIF normalize happen per file as part of
  //      the same loop.
  //   2. AI tagging dispatch — server-side, fire-and-forget. Returns
  //      quickly with a "queued" response; the actual tagging keeps
  //      running on the server even after the tab closes.
  //   3. Background removal dispatch — server-side, fire-and-forget,
  //      same fire-and-forget shape as tagging. The server's worker
  //      pool runs the model with concurrency 3.
  //
  // Once dispatch is done, phase flips to "done" and the auto-advance
  // useEffect sends the user to step 3 — no waiting required.
  async function startPipeline() {
    if (phase !== "idle" && phase !== "done") return;
    cancelRef.current = false;
    setStep(2);
    await runUploadPhase();
    if (cancelRef.current) {
      setPhase("done");
      return;
    }
    // Both dispatches return quickly (server kicks off background work
    // and acks). Run them in parallel so we don't add their latencies.
    const tasks: Promise<unknown>[] = [];
    if (aiTag) tasks.push(dispatchAiTagging());
    if (removeBg) tasks.push(dispatchBgRemoval());
    await Promise.all(tasks);
    setPhase("done");
  }

  async function runUploadPhase() {
    const pending = jobsRef.current?.filter((j) => j.state === "queued" || j.state === "error") ?? [];
    if (pending.length === 0) return;
    setPhase("uploading");

    for (const original of pending) {
      if (cancelRef.current) break;
      let working = original;

      // HEIC → JPEG, then EXIF orientation → physical pixels. Done per
      // file (rather than batch up front) so progress reflects work
      // actually completing, not a long invisible preprocessing phase.
      if (isHeic(working.file)) {
        update(working.id, { state: "processing-heic" });
        try {
          const converted = await heicToJpeg(working.file);
          if (working.previewUrl) URL.revokeObjectURL(working.previewUrl);
          const newPreview = URL.createObjectURL(converted);
          update(working.id, { file: converted, previewUrl: newPreview });
          working = { ...working, file: converted, previewUrl: newPreview };
        } catch (err) {
          console.error("HEIC conversion failed", err);
          update(working.id, { state: "error", error: "HEIC conversion failed" });
          continue;
        }
      }
      try {
        const reoriented = await normalizeOrientation(working.file);
        if (reoriented !== working.file) {
          if (working.previewUrl) URL.revokeObjectURL(working.previewUrl);
          const newPreview = URL.createObjectURL(reoriented);
          update(working.id, { file: reoriented, previewUrl: newPreview });
          working = { ...working, file: reoriented, previewUrl: newPreview };
        }
      } catch (err) {
        console.warn("orientation normalize failed for bulk job", err);
      }

      update(working.id, { state: "uploading" });
      try {
        const fd = new FormData();
        fd.append("category", defaultCategory);
        fd.append("status", defaultStatus);
        fd.append("images", working.file, working.file.name);
        const res = await fetch("/api/items/bulk", { method: "POST", body: fd });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { created: Array<{ id: string; imagePath: string }> };
        const created = data.created?.[0];
        if (!created) throw new Error("Server returned no created item");
        update(working.id, { itemId: created.id, state: "uploaded" });
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Upload failed";
        update(working.id, { state: "error", error: message.slice(0, 200) });
      }
    }

    // Notification so the user knows it's safe to close the tab.
    const uploadedIds = (jobsRef.current ?? [])
      .map((j) => j.itemId)
      .filter((x): x is string => !!x);
    if (uploadedIds.length > 0) {
      try {
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Import complete",
            body: `${uploadedIds.length} item${uploadedIds.length === 1 ? "" : "s"} saved${defaultStatus === "needs_review" ? " — waiting for review" : ""}.`,
            href: defaultStatus === "needs_review" ? "/wardrobe/needs-review" : "/wardrobe",
          }),
        });
      } catch {
        /* ignore */
      }
    }

    router.refresh();
  }

  // Server-side AI tag dispatch. Runs even after the tab closes (Node
  // always-on), so the user can leave step 2 the moment uploads finish.
  async function dispatchAiTagging() {
    const uploadedIds = (jobsRef.current ?? [])
      .map((j) => j.itemId)
      .filter((x): x is string => !!x);
    if (uploadedIds.length === 0) return;
    try {
      const res = await fetch("/api/ai/tag-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: uploadedIds,
          promoteAtConfidence,
          background: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.enabled === false) {
        setAiBanner(data.message ?? "AI tagging is disabled — set AI_PROVIDER in .env.");
      } else if (data?.queued) {
        setAiBanner(
          `AI is tagging ${data.count} item${data.count === 1 ? "" : "s"} in the background — close this tab any time, you'll get a notification when it's done.`,
        );
      }
    } catch (err) {
      console.error(err);
      setAiBanner("Couldn't start AI tagging.");
    }
  }

  // Server-side bg removal dispatch. Mirrors the AI-tag flow above —
  // returns immediately, the server runs the model with concurrency 3
  // and fires a notification when done. The user can close the tab.
  async function dispatchBgRemoval() {
    const uploadedIds = (jobsRef.current ?? [])
      .map((j) => j.itemId)
      .filter((x): x is string => !!x);
    if (uploadedIds.length === 0) return;
    try {
      const res = await fetch("/api/items/bg-remove-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: uploadedIds, background: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.queued) {
        setBgBanner(
          `Cutting out backgrounds for ${data.count} item${data.count === 1 ? "" : "s"} on the server — close this tab any time, you'll get a notification when it's done.`,
        );
      } else if (!res.ok) {
        setBgBanner(data?.error ?? "Couldn't start background removal.");
      }
    } catch (err) {
      console.error(err);
      setBgBanner("Couldn't reach the server to start background removal.");
    }
  }

  async function retryFailed() {
    cancelRef.current = false;
    await runUploadPhase();
  }

  // Mirror the latest jobs into a ref for use inside async callbacks.
  const jobsRef = useRef<Job[] | null>(null);
  jobsRef.current = jobs;

  const counts = useMemo(() => {
    return jobs.reduce(
      (acc, j) => {
        acc.total++;
        if (j.state === "uploaded") acc.uploaded++;
        if (j.state === "error") acc.error++;
        return acc;
      },
      { total: 0, uploaded: 0, error: 0 },
    );
  }, [jobs]);

  // Aggregate progress for the upload phase. Bg removal + AI tagging
  // both run server-side asynchronously after uploads finish, so they
  // don't show per-job progress here — banners on step 3 surface their
  // status instead.
  const progressTotal = jobs.length;
  const progressDone = jobs.filter(
    (j) => j.state === "uploaded" || j.state === "error",
  ).length;
  const progressFraction = progressTotal === 0 ? 0 : progressDone / progressTotal;
  const progressLabel =
    phase === "uploading" ? `Uploading ${progressDone} / ${progressTotal}` : "";

  const autoCategoryWithoutAi = defaultCategory === AUTO_CATEGORY && !aiTag;

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {step === 1 && (
        <Step1Choose
          defaultCategory={defaultCategory}
          setDefaultCategory={setDefaultCategory}
          defaultStatus={defaultStatus}
          setDefaultStatus={setDefaultStatus}
          aiTag={aiTag}
          setAiTag={setAiTag}
          promoteAtConfidence={promoteAtConfidence}
          setPromoteAtConfidence={setPromoteAtConfidence}
          removeBg={removeBg}
          setRemoveBg={setRemoveBg}
          jobs={jobs}
          onFiles={onFiles}
          onRemove={remove}
          onContinue={startPipeline}
          autoCategoryWithoutAi={autoCategoryWithoutAi}
        />
      )}

      {step === 2 && (
        <Step2Processing
          jobs={jobs}
          phase={phase}
          progressLabel={progressLabel}
          progressFraction={progressFraction}
          progressTotal={progressTotal}
          progressDone={progressDone}
          aiBanner={aiBanner}
          bgBanner={bgBanner}
          onCancel={() => {
            cancelRef.current = true;
          }}
          onRetryFailed={retryFailed}
          onRemove={remove}
          onFinishEarly={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <Step3Done
          counts={counts}
          aiBanner={aiBanner}
          bgBanner={bgBanner}
          defaultStatus={defaultStatus}
          onUploadAnother={() => {
            // Reset state for a fresh batch. Existing items are durable
            // on the server and can be reviewed via Needs Review.
            for (const j of jobs) {
              if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
            }
            setJobs([]);
            setPhase("idle");
            setAiBanner(null);
            setBgBanner(null);
            setStep(1);
          }}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex flex-1 items-center gap-2 text-xs">
      {STEPS.map((s, idx) => {
        const isPast = step > s.n;
        const isCurrent = step === s.n;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full font-semibold transition",
                isCurrent && "bg-blush-500 text-white",
                isPast && "bg-blush-200 text-blush-800",
                !isCurrent && !isPast && "bg-stone-100 text-stone-400",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              {s.n}
            </span>
            <span className={cn("hidden sm:inline", isCurrent ? "text-stone-800" : "text-stone-400")}>
              {s.label}
            </span>
            {idx < STEPS.length - 1 && <span className="h-px flex-1 bg-stone-200" />}
          </li>
        );
      })}
    </ol>
  );
}

function Step1Choose({
  defaultCategory,
  setDefaultCategory,
  defaultStatus,
  setDefaultStatus,
  aiTag,
  setAiTag,
  promoteAtConfidence,
  setPromoteAtConfidence,
  removeBg,
  setRemoveBg,
  jobs,
  onFiles,
  onRemove,
  onContinue,
  autoCategoryWithoutAi,
}: {
  defaultCategory: DefaultCategory;
  setDefaultCategory: (v: DefaultCategory) => void;
  defaultStatus: "needs_review" | "active";
  setDefaultStatus: (v: "needs_review" | "active") => void;
  aiTag: boolean;
  setAiTag: (v: boolean) => void;
  promoteAtConfidence: number;
  setPromoteAtConfidence: (v: number) => void;
  removeBg: boolean;
  setRemoveBg: (v: boolean) => void;
  jobs: Job[];
  onFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onContinue: () => void;
  autoCategoryWithoutAi: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        {/* Settings column */}
        <div className="card space-y-4 p-4">
          <div>
            <label className="label">Default category</label>
            <select
              className="input"
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value as DefaultCategory)}
            >
              <option value={AUTO_CATEGORY}>✨ Let AI decide</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              {defaultCategory === AUTO_CATEGORY
                ? "AI reads each photo and assigns the right category."
                : `Every photo becomes a ${defaultCategory} — edit individuals later.`}
            </p>
          </div>

          <div>
            <label className="label">After upload</label>
            <select
              className="input"
              value={defaultStatus}
              onChange={(e) => setDefaultStatus(e.target.value as "needs_review" | "active")}
            >
              <option value="needs_review">Send to Needs Review</option>
              <option value="active">Mark active immediately</option>
            </select>
          </div>

          <div className="space-y-2 border-t border-stone-100 pt-3">
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={aiTag}
                onChange={(e) => setAiTag(e.target.checked)}
              />
              <span>
                <span className="font-medium">🤖 Auto-tag with AI</span>
                <span className="block text-xs text-stone-500">
                  Runs on the server. Safe to close the tab — you&apos;ll get a notification.
                </span>
              </span>
            </label>
            {aiTag && (
              <label className="ml-6 flex items-center gap-2 text-xs text-stone-500">
                Auto-promote at
                <input
                  type="number"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={promoteAtConfidence}
                  onChange={(e) => setPromoteAtConfidence(Number(e.target.value))}
                  className="w-14 rounded border border-stone-200 px-1 text-xs"
                />
                confidence
              </label>
            )}

            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={removeBg}
                onChange={(e) => setRemoveBg(e.target.checked)}
              />
              <span>
                <span className="font-medium">✂️ Remove backgrounds</span>
                <span className="block text-xs text-stone-500">
                  {removeBg
                    ? "Runs on the server. Safe to close the tab — you'll get a notification when it's done."
                    : "Skip background removal for this batch."}
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Photo picker column */}
        <div className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-stone-800">Photos</p>
              <p className="text-xs text-stone-500">
                {jobs.length === 0
                  ? "Pick a stack from your phone or library."
                  : `${jobs.length} photo${jobs.length === 1 ? "" : "s"} ready.`}
              </p>
            </div>
            {/* The native file picker is the most reliable trigger on
                iOS Safari — wrapping the visible button as a <label> for
                a hidden <input> avoids the programmatic .click() dance
                that some browsers gate on user-gesture context. */}
            <label className="btn-primary cursor-pointer">
              📸 {jobs.length === 0 ? "Pick photos" : "Add more"}
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                onChange={onFiles}
                className="sr-only"
              />
            </label>
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-2xl bg-cream-50 p-8 text-center text-sm text-stone-500 ring-1 ring-stone-100">
              iPhone Safari supports multi-select from the Photo Library. Tap{" "}
              <span className="font-medium text-stone-700">Pick photos</span> above to start.
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {jobs.map((j) => (
                <li key={j.id} className="group relative">
                  <div className="tile-bg flex aspect-square items-center justify-center overflow-hidden rounded-xl p-1.5 ring-1 ring-stone-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={j.previewUrl}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => onRemove(j.id)}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-stone-500 shadow-card hover:text-blush-700"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {autoCategoryWithoutAi && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
          &ldquo;Let AI decide&rdquo; needs Auto-tag turned on. Either enable Auto-tag, or pick a
          specific category — otherwise every item lands as a placeholder you&apos;ll need to fix later.
        </div>
      )}

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
        Tip: don&apos;t mix label / tag close-ups into a bulk upload — each photo becomes its own
        item. Add label photos from the item&apos;s detail page after.
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/wardrobe" className="btn-ghost text-stone-500">
          Cancel
        </Link>
        <button
          type="button"
          onClick={onContinue}
          disabled={jobs.length === 0 || autoCategoryWithoutAi}
          className="btn-primary disabled:opacity-50"
        >
          Continue → Process {jobs.length || ""}
        </button>
      </div>
    </>
  );
}

function Step2Processing({
  jobs,
  phase,
  progressLabel,
  progressFraction,
  progressTotal,
  aiBanner,
  bgBanner,
  onCancel,
  onRetryFailed,
  onRemove,
  onFinishEarly,
}: {
  jobs: Job[];
  phase: Phase;
  progressLabel: string;
  progressFraction: number;
  progressTotal: number;
  progressDone: number;
  aiBanner: string | null;
  bgBanner: string | null;
  onCancel: () => void;
  onRetryFailed: () => void;
  onRemove: (id: string) => void;
  onFinishEarly: () => void;
}) {
  const hasFailures = jobs.some((j) => j.state === "error");
  const stillRunning = phase === "uploading";
  return (
    <>
      {progressTotal > 0 && (
        <ProgressBar
          value={progressFraction}
          label={progressLabel}
          hint={
            phase === "uploading"
              ? "one photo at a time — already-uploaded photos are safe even if you close this tab"
              : undefined
          }
        />
      )}

      {aiBanner && (
        <div className="rounded-xl bg-blush-100/60 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          🤖 {aiBanner}
        </div>
      )}

      {bgBanner && (
        <div className="rounded-xl bg-blush-100/60 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          ✂️ {bgBanner}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {jobs.map((j) => (
          <li key={j.id} className="card overflow-hidden">
            <div className="tile-bg flex aspect-square items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={j.previewUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
            <div className="px-3 py-2 text-xs">
              <p className="truncate text-stone-700">{j.file.name}</p>
              <p
                className={cn(
                  j.state === "uploaded" && "text-sage-600",
                  j.state === "error" && "text-blush-700",
                  j.state !== "uploaded" && j.state !== "error" && "text-stone-500",
                )}
              >
                {labelFor(j.state)}{j.error ? ` — ${j.error}` : ""}
              </p>
              <div className="mt-1 flex items-center justify-between">
                {j.itemId && (
                  <Link href={`/wardrobe/${j.itemId}`} className="text-blush-600 hover:underline">
                    Open
                  </Link>
                )}
                {(j.state === "queued" || j.state === "error" || j.state === "uploaded") && (
                  <button
                    type="button"
                    onClick={() => onRemove(j.id)}
                    className="text-stone-400 hover:text-stone-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasFailures && !stillRunning && (
          <button type="button" onClick={onRetryFailed} className="btn-ghost text-blush-600">
            Retry failed
          </button>
        )}
        {stillRunning && (
          <button type="button" onClick={onCancel} className="btn-ghost text-stone-500">
            Cancel — finish with what&apos;s saved
          </button>
        )}
        <button
          type="button"
          onClick={onFinishEarly}
          disabled={progressTotal === 0}
          className="btn-secondary disabled:opacity-50"
        >
          {stillRunning ? "Skip to summary" : "Finish"}
        </button>
      </div>
    </>
  );
}

function Step3Done({
  counts,
  aiBanner,
  bgBanner,
  defaultStatus,
  onUploadAnother,
}: {
  counts: { total: number; uploaded: number; error: number };
  aiBanner: string | null;
  bgBanner: string | null;
  defaultStatus: "needs_review" | "active";
  onUploadAnother: () => void;
}) {
  const reviewHref = defaultStatus === "needs_review" ? "/wardrobe/needs-review" : "/wardrobe";
  return (
    <>
      <div className="card space-y-2 p-6">
        <p className="text-2xl">✓</p>
        <h2 className="font-display text-2xl text-stone-800">
          {counts.uploaded === 0
            ? "Nothing saved this round"
            : `${counts.uploaded} item${counts.uploaded === 1 ? "" : "s"} saved`}
        </h2>
        {counts.error > 0 && (
          <p className="text-sm text-blush-700">
            {counts.error} failed — see the queue above for details.
          </p>
        )}
      </div>

      {aiBanner && (
        <div className="rounded-xl bg-blush-100/60 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          🤖 {aiBanner}
        </div>
      )}

      {bgBanner && (
        <div className="rounded-xl bg-blush-100/60 px-3 py-2 text-sm text-blush-800 ring-1 ring-blush-200">
          ✂️ {bgBanner}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={reviewHref} className="btn-primary">
          {defaultStatus === "needs_review" ? "Open Needs Review" : "Open Closet"}
        </Link>
        <Link href="/wardrobe" className="btn-secondary">
          Back to Closet
        </Link>
        <button type="button" onClick={onUploadAnother} className="btn-ghost text-stone-500">
          Upload another batch
        </button>
      </div>
    </>
  );
}

function labelFor(state: Job["state"]): string {
  switch (state) {
    case "queued": return "Queued";
    case "processing-heic": return "Converting HEIC…";
    case "uploading": return "Uploading…";
    case "uploaded": return "Saved";
    case "error": return "Failed";
  }
}
