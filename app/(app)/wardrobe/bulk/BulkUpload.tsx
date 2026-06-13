"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CATEGORIES,
  SPICY_CATEGORIES,
  BEAUTY_CATEGORIES,
  BEAUTY_CATEGORY_GROUPS,
} from "@/lib/constants";
import { heicToJpeg, isHeic } from "@/lib/heic";
import ProgressBar from "@/components/ProgressBar";
import { cn } from "@/lib/cn";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

// Sentinel for the "Let AI decide" option. The bulk endpoint accepts
// this and stores a placeholder category until AI tagging fills the
// real one in.
const AUTO_CATEGORY = "__auto__" as const;
// Widened to plain string so the dropdown can hold either main or
// SPICY_CATEGORIES values when allBackroom is on.
type DefaultCategory = string;

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
  // Every upload is active immediately now — the "Needs Review" queue
  // was removed. Kept as a const for the FormData append below so the
  // server-side validator gets an explicit value (matches the single-
  // add form's default).
  const defaultStatus = "active" as const;
  // "Mark all as Backroom" — applied to every item in this batch. The
  // edit page lets the user toggle individual rows back if they
  // accidentally lumped a non-Backroom photo in.
  const [allBackroom, setAllBackroom] = useState(false);
  // Same shape for "Mark all as Beauty". Independent of Backroom —
  // both can be on, in which case items land as both spicy + beauty.
  const [allBeauty, setAllBeauty] = useState(false);
  const [removeBg, setRemoveBg] = useState(true);
  const [aiTag, setAiTag] = useState(true);
  const [promoteAtConfidence, setPromoteAtConfidence] = useState(0.85);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [aiBanner, setAiBanner] = useState<string | null>(null);
  const [bgBanner, setBgBanner] = useState<string | null>(null);
  // When the user taps "Retry failed", the pipeline picks up
  // previously-errored jobs but the Step 2 grid would otherwise still
  // show every job in history — including the dozens that already
  // succeeded — making it hard to track what's actually happening on
  // the retry. Snapshot the retried ids here and filter the grid
  // while the walk is in flight; cleared once allTerminal flips phase
  // back to "done" so subsequent runs go back to the full view.
  const [retryingIds, setRetryingIds] = useState<string[] | null>(null);
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
      // Walk's done — reset the retry filter so a future retry from
      // Step 3 (or a fresh batch via "Upload another") gets a clean
      // slate rather than carrying over a stale list.
      setRetryingIds(null);
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

    // Bounded concurrency. The old loop sent one POST at a time and
    // fully awaited the server's per-file work (sharp rotate + display
    // re-encode + original re-encode + perceptual hash) before
    // starting the next photo, so a 50-photo import was ~50× the
    // single-file latency. Running a few in flight overlaps the
    // network wait + server work and roughly cuts wall time by this
    // factor. Kept low (3) because each concurrent sharp pipeline on
    // the Proxmox LXC is ~tens of MB of RAM and the box is CPU-bound —
    // higher just thrashes. Tune here if the deploy gets more cores.
    const CONCURRENCY = 3;

    // Shared cursor. JS is single-threaded so workers incrementing a
    // closure-scoped index is race-free; each worker pulls the next
    // unclaimed job until the queue drains (or the user cancels).
    let cursor = 0;
    const processNext = async (): Promise<void> => {
      while (true) {
        if (cancelRef.current) return;
        const i = cursor++;
        if (i >= pending.length) return;
        await processOneJob(pending[i]);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => processNext()),
    );

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
            body: `${uploadedIds.length} item${uploadedIds.length === 1 ? "" : "s"} saved.`,
            href: "/wardrobe",
          }),
        });
      } catch {
        /* ignore */
      }
    }

    // One RSC refresh after the whole pool drains so the closet
    // count / recents pick up the new items — instead of 1 per file.
    router.refresh();
  }

  // One job's full lifecycle: HEIC convert (if needed) → upload →
  // mark uploaded/error. Pulled out of runUploadPhase so the worker
  // pool can call it concurrently. No client-side EXIF normalize —
  // saveUploadWithOriginal does sharp().rotate() server-side, and
  // <img> honors EXIF for the preview, so the old client-side canvas
  // re-encode (the worst main-thread freeze) was pure redundant work.
  async function processOneJob(original: Job) {
    let working = original;

    // Clear any leftover error string from a previous failed attempt
    // so the mid-flight label (e.g. "Processing HEIC…") doesn't
    // render with a stale "— Load failed" suffix while the retry
    // runs. The error gets re-set below if this attempt also fails.
    if (working.error) {
      update(working.id, { error: undefined });
      working = { ...working, error: undefined };
    }

    // HEIC → JPEG stays client-side: the server's sharp build can't
    // decode HEIC, so this conversion is required (not redundant
    // like the orientation bake was).
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
        return;
      }
    }

    update(working.id, { state: "uploading" });
    try {
      const fd = new FormData();
      fd.append("category", defaultCategory);
      fd.append("status", defaultStatus);
      if (allBackroom) fd.append("isBackroom", "1");
      if (allBeauty) fd.append("isBeauty", "1");
      fd.append("images", working.file, working.file.name);
      const res = await fetch("/api/items/bulk", { method: "POST", body: fd });
      if (!res.ok) {
        // Pull the server's reason if we can. JSON 4xx responses from
        // /api/items/bulk look like { error: "..." }; non-JSON
        // failures (nginx 413, generic 500 HTML) get fallback to the
        // status code so the user doesn't see a wall of HTML.
        const ct = res.headers.get("content-type") || "";
        let detail = "";
        if (ct.includes("application/json")) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          detail = body?.error ?? "";
        } else {
          const text = (await res.text().catch(() => "")).trim();
          // Heuristic: HTML error pages aren't useful to surface;
          // keep a short text body if it's plausibly a plain message.
          if (text && !text.startsWith("<") && text.length < 500) detail = text;
        }
        throw new Error(detail || `HTTP ${res.status} ${res.statusText || ""}`.trim());
      }
      const data = (await res.json()) as { created: Array<{ id: string; imagePath: string }> };
      const created = data.created?.[0];
      if (!created) throw new Error("Server returned no created item");
      // Clear any leftover `error` from a previous failed attempt
      // so a successful retry doesn't render "Saved — Load failed".
      update(working.id, { itemId: created.id, state: "uploaded", error: undefined });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Upload failed";
      // Cap is generous so the user sees the full server message
      // (e.g. a 413 body, a sharp error explaining a corrupt JPEG)
      // instead of a head-truncated snippet that ends mid-sentence.
      update(working.id, { state: "error", error: message.slice(0, 500) });
    }
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
      } else if (!res.ok) {
        // 4xx/5xx with no recognizable body (HTML error page, etc.) —
        // without this branch the user gets no banner at all and has
        // no idea tagging never started.
        setAiBanner(`Couldn't start AI tagging (HTTP ${res.status}).`);
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
    // Phase guard: while a runUploadPhase walk is in flight, phase
    // is "uploading". A double-tap on the in-row "Retry failed"
    // button (Step 2) without this guard would start a second
    // concurrent walk that picks up the same error rows from
    // jobsRef.current, both POSTing /api/items/bulk for each one
    // and creating duplicate Items. startPipeline has the matching
    // guard for the same reason.
    if (phase === "uploading") return;
    cancelRef.current = false;
    // Snapshot the failed ids so Step 2's grid can narrow to just
    // these rows during the retry. Cleared by the allTerminal effect
    // once the walk finishes.
    const ids = (jobsRef.current ?? [])
      .filter((j) => j.state === "error")
      .map((j) => j.id);
    if (ids.length > 0) setRetryingIds(ids);
    await runUploadPhase();
  }

  // Mirror the latest jobs into a ref for use inside async callbacks.
  const jobsRef = useRef<Job[] | null>(null);
  jobsRef.current = jobs;

  // Dirty while there are photos that haven't all finished uploading.
  // Once phase === "done" every item is durable on the server, so
  // leaving Step 3 loses nothing and shouldn't prompt. Picked-but-
  // not-started (Step 1) and mid-upload (Step 2) both lose work.
  useUnsavedChanges(jobs.length > 0 && phase !== "done");

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
          aiTag={aiTag}
          setAiTag={setAiTag}
          promoteAtConfidence={promoteAtConfidence}
          setPromoteAtConfidence={setPromoteAtConfidence}
          removeBg={removeBg}
          setRemoveBg={setRemoveBg}
          allBackroom={allBackroom}
          setAllBackroom={setAllBackroom}
          allBeauty={allBeauty}
          setAllBeauty={setAllBeauty}
          jobs={jobs}
          onFiles={onFiles}
          onRemove={remove}
          onContinue={startPipeline}
          autoCategoryWithoutAi={autoCategoryWithoutAi}
        />
      )}

      {step === 2 && (
        <Step2Processing
          jobs={
            // During a retry walk, narrow the grid to just the photos
            // being retried — the user doesn't need to scroll past
            // every prior success to see what's happening now.
            retryingIds
              ? jobs.filter((j) => retryingIds.includes(j.id))
              : jobs
          }
          isRetry={retryingIds !== null}
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
          failedJobs={jobs.filter((j) => j.state === "error")}
          aiBanner={aiBanner}
          bgBanner={bgBanner}
          onRetryFailed={async () => {
            // Re-enter the full pipeline so the retried items also
            // pick up AI tagging + bg removal dispatches and so the
            // post-upload setPhase("done") fires (which is what the
            // allTerminal effect waits on to bring the user back to
            // Step 3). startPipeline's guard accepts phase="done",
            // which is the state we're always in once Step 3 paints,
            // so this is safe to call directly.
            //
            // Snapshot the failed ids before the walk so Step 2's
            // grid filters to just the retried photos — otherwise
            // the user gets bounced back to a wall of every job
            // they ever uploaded in this session.
            const ids = (jobsRef.current ?? [])
              .filter((j) => j.state === "error")
              .map((j) => j.id);
            if (ids.length > 0) setRetryingIds(ids);
            await startPipeline();
          }}
          onUploadAnother={() => {
            // Reset state for a fresh batch. Existing items stay
            // saved on the server.
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
  aiTag,
  setAiTag,
  promoteAtConfidence,
  setPromoteAtConfidence,
  removeBg,
  setRemoveBg,
  allBackroom,
  setAllBackroom,
  allBeauty,
  setAllBeauty,
  jobs,
  onFiles,
  onRemove,
  onContinue,
  autoCategoryWithoutAi,
}: {
  defaultCategory: DefaultCategory;
  setDefaultCategory: (v: DefaultCategory) => void;
  aiTag: boolean;
  setAiTag: (v: boolean) => void;
  promoteAtConfidence: number;
  setPromoteAtConfidence: (v: number) => void;
  removeBg: boolean;
  setRemoveBg: (v: boolean) => void;
  allBackroom: boolean;
  setAllBackroom: (v: boolean) => void;
  allBeauty: boolean;
  setAllBeauty: (v: boolean) => void;
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
              onChange={(e) => setDefaultCategory(e.target.value)}
            >
              <option value={AUTO_CATEGORY}>✨ Let AI decide</option>
              {/* When the batch is being marked all-Beauty the
                  dropdown swaps to BEAUTY_CATEGORIES (sectioned by
                  group), all-Spicy swaps to SPICY_CATEGORIES,
                  otherwise the main 14. Beauty wins over Spicy when
                  both are on (mirrors the per-item form). */}
              {allBeauty
                ? BEAUTY_CATEGORY_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  ))
                : (allBackroom ? SPICY_CATEGORIES : CATEGORIES).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              {defaultCategory === AUTO_CATEGORY
                ? "AI reads each photo and assigns the right category."
                : `Every photo becomes a ${defaultCategory} — edit individuals later.`}
            </p>
            {autoCategoryWithoutAi && (
              <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200">
                ⚠ <strong>✨ Let AI decide</strong> needs Auto-tag turned on below — Continue is disabled until you flip it on, or pick a specific category above.
              </p>
            )}
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

            {/* Mark every item in this batch as Backroom — useful when
                doing a single-session intimate-import (lingerie set,
                costume haul, etc). Per-item override happens via the
                edit page after upload. */}
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allBackroom}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAllBackroom(next);
                  // Toggling switches the category dropdown. If the
                  // current pick isn't in the new vocabulary, snap
                  // back to ✨ Auto so the dropdown isn't stuck on a
                  // value that's not selectable.
                  const list: readonly string[] = next ? SPICY_CATEGORIES : CATEGORIES;
                  if (defaultCategory !== AUTO_CATEGORY && !list.includes(defaultCategory)) {
                    setDefaultCategory(AUTO_CATEGORY);
                  }
                }}
              />
              <span>
                <span className="font-medium">🌶 Mark all as Spicy</span>
                <span className="block text-xs text-stone-500">
                  {allBackroom
                    ? "Every item lands on the Spicy page only — hidden from the main closet, outfit builder, and AI prompts."
                    : "Send every item in this batch to the Spicy page."}
                </span>
              </span>
            </label>

            {/* "Mark all as Beauty" — same shape; sends every item
                in the batch to /wardrobe/beauty. Independent of 🌶
                (both can be on, in which case items land in both
                buckets). When checked, the Default category dropdown
                above swaps to BEAUTY_CATEGORIES. */}
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allBeauty}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAllBeauty(next);
                  // Same vocabulary-snap as Spicy: if the current
                  // pick isn't in the new (beauty / non-beauty)
                  // list, fall back to ✨ Auto.
                  const list: readonly string[] = next
                    ? BEAUTY_CATEGORIES
                    : (allBackroom ? SPICY_CATEGORIES : CATEGORIES);
                  if (defaultCategory !== AUTO_CATEGORY && !list.includes(defaultCategory)) {
                    setDefaultCategory(AUTO_CATEGORY);
                  }
                }}
              />
              <span>
                <span className="font-medium">💄 Mark all as Beauty</span>
                <span className="block text-xs text-stone-500">
                  {allBeauty
                    ? "Every item lands on the Beauty page only — separate from the main closet and AI outfit prompts."
                    : "Send every item in this batch to the Beauty page."}
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
  isRetry,
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
  /** True when this view is showing the filtered subset of a retry
   *  walk. Drives the banner + the "Finish" button label so the user
   *  knows they're not looking at every job, just the retried ones. */
  isRetry: boolean;
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
      {isRetry && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          ↻ Retrying {jobs.length} photo{jobs.length === 1 ? "" : "s"}. Your previously-saved
          photos are safe — they aren&apos;t shown here while the retry runs.
        </div>
      )}
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
  failedJobs,
  aiBanner,
  bgBanner,
  onRetryFailed,
  onUploadAnother,
}: {
  counts: { total: number; uploaded: number; error: number };
  failedJobs: Job[];
  aiBanner: string | null;
  bgBanner: string | null;
  onRetryFailed: () => void | Promise<void>;
  onUploadAnother: () => void;
}) {
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
            {counts.error} failed — details below.
          </p>
        )}
      </div>

      {/* Per-failure detail. Step 2 had the live queue with each
          job's error message inline, but Step 3 used to drop that
          and just summarize "N failed — see the queue above"
          while the queue was already gone. Render the failures
          here so the user can actually see the cause without
          having to back out and re-upload. */}
      {failedJobs.length > 0 && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-blush-800">What failed</p>
            {/* In-card retry: re-runs only the error rows. Successful
                uploads stay as-is on the server. */}
            <button
              type="button"
              onClick={onRetryFailed}
              className="btn-secondary text-xs"
            >
              ↻ Retry {failedJobs.length} failed
            </button>
          </div>
          <ul className="space-y-3">
            {failedJobs.map((j) => {
              const reason = prettifyError(j.error);
              return (
                <li key={j.id} className="flex items-start gap-3 text-sm">
                  <div className="tile-bg h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={j.previewUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-stone-800">{j.file.name}</p>
                    <p className="break-words text-xs text-blush-700">{reason.summary}</p>
                    {reason.hint && (
                      <p className="mt-0.5 break-words text-xs text-stone-500">{reason.hint}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
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

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/wardrobe" className="btn-primary">
          Open Closet
        </Link>
        <button type="button" onClick={onUploadAnother} className="btn-ghost text-stone-500">
          Upload another batch
        </button>
      </div>
    </>
  );
}

// Map raw error strings (server JSON.error fields, sharp / HEIC
// failures, fetch crashes, generic HTTP statuses) to a friendly
// summary + optional actionable hint. Falls back to the raw message
// on anything unrecognized so the user still sees the original
// detail. Pattern order matters — the first match wins, so the most
// specific patterns sit on top.
function prettifyError(raw: string | null | undefined): { summary: string; hint?: string } {
  const message = (raw ?? "").trim();
  if (!message) return { summary: "Upload failed (no detail returned by the server)." };

  const lower = message.toLowerCase();

  if (lower.includes("heic")) {
    return {
      summary: "Couldn't convert this iPhone HEIC photo.",
      hint:
        "Tip: on iPhone, Settings → Camera → Formats → Most Compatible saves new photos as JPEG.",
    };
  }
  if (
    lower.includes("413") ||
    lower.includes("payload too large") ||
    lower.includes("request entity too large")
  ) {
    return {
      summary: "Photo is too large for the server.",
      hint: "Limit is around 10 MB per photo. Try shrinking it or shooting at lower resolution.",
    };
  }
  if (lower.includes("missing or invalid category")) {
    return {
      summary: "Server rejected the upload — no usable category.",
      hint: "Pick a real category instead of ✨ Auto, or turn on AI tagging so it can pick one.",
    };
  }
  if (lower.includes("missing image") || lower.includes("no images attached")) {
    return { summary: "The server didn't see an image attached. Try the photo again." };
  }
  if (lower.includes("max 50 photos")) {
    return {
      summary: "Too many photos in one batch.",
      hint: "Split the upload into runs of 50 or fewer.",
    };
  }
  if (lower.includes("unauthorized") || lower.includes("http 401")) {
    return {
      summary: "Your session timed out.",
      hint: "Sign in again and tap ↻ Retry — the failed photos will pick up from here.",
    };
  }
  if (lower.includes("vipsjpeg") || lower.includes("input file") || lower.includes("unsupported image")) {
    return {
      summary: "Image data is corrupt or in an unsupported format.",
      hint: "Try a different photo or re-export the original.",
    };
  }
  if (
    lower.startsWith("http 5") ||
    lower.includes("internal server error") ||
    lower.includes("500")
  ) {
    return {
      summary: "Server hiccup.",
      hint: "Tap ↻ Retry — most 500s clear themselves on a second attempt.",
    };
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to fetch")) {
    return {
      summary: "Couldn't reach the server.",
      hint: "Check your connection and tap ↻ Retry.",
    };
  }

  // Unrecognized — show the raw message verbatim so the cause isn't
  // lost. This is what we shipped before this helper existed.
  return { summary: message };
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
