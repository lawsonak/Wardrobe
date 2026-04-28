"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, type Category } from "@/lib/constants";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";

// Two-phase pipeline:
//   1. Upload — every picked photo goes to /api/items/bulk in a single
//      multipart POST. Each becomes an Item with status=needs_review.
//      The page can be closed safely after this step; the photos are
//      durably saved on the server.
//   2. BG removal (optional, client-side) — once items exist on the
//      server, this page walks them and POSTs each bg-removed cutout
//      to /api/items/[id]/photo?which=bg. Page must stay open for this
//      part. Skippable, pausable, and re-runnable later from Needs
//      Review (per-item) or from this page after another upload.

type Job = {
  id: string;             // local id while queued
  itemId?: string;        // server id once uploaded
  file: File;             // possibly HEIC-converted file we send to server
  previewUrl: string;
  bgUrl?: string;
  state: "queued" | "processing-heic" | "uploaded" | "removing-bg" | "done" | "error";
  error?: string;
};

let nextId = 1;

export default function BulkUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [defaultCategory, setDefaultCategory] = useState<Category>("Tops");
  const [defaultStatus, setDefaultStatus] = useState<"needs_review" | "active">("needs_review");
  const [removeBg, setRemoveBg] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "tagging" | "done">("idle");

  useEffect(() => {
    return () => {
      for (const j of jobs) {
        if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
        if (j.bgUrl) URL.revokeObjectURL(j.bgUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFiles() {
    setShowWarning(true);
    fileRef.current?.click();
  }

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
      if (j) {
        if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
        if (j.bgUrl) URL.revokeObjectURL(j.bgUrl);
      }
      return prev.filter((x) => x.id !== id);
    });
  }

  // Phase 1: HEIC-convert (if needed) and ship every picked file to the
  // server in one bulk POST. After this returns, the photos are durably
  // saved as Items — the user can close the tab and walk away.
  async function uploadAll() {
    if (running) return;
    const pending = jobs.filter((j) => j.state === "queued" || j.state === "error");
    if (pending.length === 0) return;
    setRunning(true);
    setPhase("uploading");

    // Pre-process HEIC sequentially so we don't blow up memory on a big
    // batch of iPhone photos.
    const ready: Job[] = [];
    for (const j of pending) {
      if (isHeic(j.file)) {
        update(j.id, { state: "processing-heic" });
        try {
          const converted = await heicToJpeg(j.file);
          // Replace preview with the JPEG so the grid renders.
          if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
          const newPreview = URL.createObjectURL(converted);
          update(j.id, { file: converted, previewUrl: newPreview });
          ready.push({ ...j, file: converted, previewUrl: newPreview });
        } catch (err) {
          console.error("HEIC conversion failed", err);
          update(j.id, { state: "error", error: "HEIC conversion failed" });
        }
      } else {
        ready.push(j);
      }
    }

    // One POST with every file attached.
    try {
      const fd = new FormData();
      fd.append("category", defaultCategory);
      fd.append("status", defaultStatus);
      for (const j of ready) {
        fd.append("images", j.file, j.file.name);
      }
      const res = await fetch("/api/items/bulk", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { created: Array<{ id: string; imagePath: string }> };
      // Match server ids back to local jobs by index.
      data.created.forEach((c, idx) => {
        const j = ready[idx];
        if (!j) return;
        update(j.id, { itemId: c.id, state: "uploaded" });
      });
    } catch (err) {
      console.error(err);
      // Mark all the just-tried jobs as errored if the bulk POST failed.
      for (const j of ready) update(j.id, { state: "error", error: "Upload failed" });
    }

    // Notification so the user knows it's safe to close the tab.
    try {
      const uploadedCount = ready.filter(
        (j) => jobsRef.current?.find((x) => x.id === j.id)?.state === "uploaded",
      ).length || ready.length;
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Bulk upload complete",
          body: `${uploadedCount} item${uploadedCount === 1 ? "" : "s"} saved${defaultStatus === "needs_review" ? " — waiting for review" : ""}.`,
          href: defaultStatus === "needs_review" ? "/wardrobe/needs-review" : "/wardrobe",
        }),
      });
    } catch {
      /* ignore */
    }

    setRunning(false);
    setPhase("done");
    router.refresh();

    // Phase 2: bg removal, only if asked for. Page must stay open here.
    if (removeBg) {
      await runBgRemoval();
    }
  }

  // Phase 2: walk uploaded jobs and POST a bg-removed variant per item.
  async function runBgRemoval() {
    const pending = jobsRef.current?.filter((j) => j.state === "uploaded") ?? [];
    if (pending.length === 0) return;
    setRunning(true);
    setPhase("tagging");
    for (const j of pending) {
      if (!j.itemId) continue;
      update(j.id, { state: "removing-bg" });
      try {
        const out = await removeBackground(j.file);
        const fd = new FormData();
        fd.append("which", "bg");
        fd.append("imageBgRemoved", new File([out], "bg.png", { type: "image/png" }));
        const res = await fetch(`/api/items/${j.itemId}/photo`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
        const url = URL.createObjectURL(out);
        update(j.id, { state: "done", bgUrl: url });
      } catch (err) {
        console.error(err);
        update(j.id, { state: "error", error: "BG removal failed" });
      }
    }
    setRunning(false);
    setPhase("done");
    router.refresh();
  }

  // Mirror the latest jobs into a ref for use inside async callbacks.
  const jobsRef = useRef<Job[] | null>(null);
  jobsRef.current = jobs;

  const counts = jobs.reduce(
    (acc, j) => {
      acc.total++;
      if (j.state === "done") acc.done++;
      else if (j.state === "uploaded") acc.uploaded++;
      else if (j.state === "error") acc.error++;
      else if (j.state !== "queued") acc.running++;
      return acc;
    },
    { total: 0, done: 0, uploaded: 0, error: 0, running: 0 },
  );

  const queuedCount = jobs.filter((j) => j.state === "queued" || j.state === "error").length;
  const uploadedNeedingBg = jobs.filter((j) => j.state === "uploaded").length;

  return (
    <div className="space-y-5">
      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Default category</label>
            <select
              className="input"
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">Per-item edits happen in Needs Review.</p>
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
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
          Remove backgrounds after upload (keep this tab open for that part)
        </label>
        <p className="text-xs text-stone-500">
          Uploads finish in one round trip — once you see &ldquo;Uploaded&rdquo; below, the photos are
          saved server-side and you can close this tab. Background removal then keeps running
          in this tab if you leave it open. You can re-run it any time from the item detail page.
        </p>
      </div>

      {showWarning && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
          Tip: don&apos;t mix label / tag close-ups into a bulk upload — each photo becomes its own
          item. Add label photos from the item&apos;s detail page after.
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={onFiles}
        className="hidden"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={pickFiles} className="btn-primary">
          📸 Pick photos
        </button>
        <button
          type="button"
          onClick={uploadAll}
          className="btn-secondary"
          disabled={running || queuedCount === 0}
        >
          {running && phase === "uploading" ? "Uploading…" : `Upload ${queuedCount || jobs.length} photo${jobs.length === 1 ? "" : "s"}`}
        </button>
        {uploadedNeedingBg > 0 && (
          <button
            type="button"
            onClick={runBgRemoval}
            className="btn-secondary"
            disabled={running}
            title="Process bg removal on already-uploaded items"
          >
            {running && phase === "tagging" ? "Removing…" : `Remove bg on ${uploadedNeedingBg}`}
          </button>
        )}
        {jobs.some((j) => j.state === "error") && (
          <button
            type="button"
            onClick={async () => { resetBackgroundRemover(); await uploadAll(); }}
            className="btn-ghost text-blush-600"
            disabled={running}
          >
            Retry failed
          </button>
        )}
        {counts.total > 0 && (
          <span className="text-xs text-stone-500">
            {counts.done}/{counts.total} done · {counts.uploaded} uploaded
            {counts.error ? ` · ${counts.error} failed` : ""}
          </span>
        )}
      </div>

      {phase === "done" && counts.uploaded === 0 && counts.error === 0 && counts.done > 0 && (
        <div className="rounded-xl bg-sage-200/40 px-3 py-2 text-sm text-sage-600 ring-1 ring-sage-200">
          ✓ All done. You can close this tab.
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {jobs.map((j) => (
            <li key={j.id} className="card overflow-hidden">
              <div className="tile-bg flex aspect-square items-center justify-center p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={j.bgUrl ?? j.previewUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="px-3 py-2 text-xs">
                <p className="truncate text-stone-700">{j.file.name}</p>
                <p
                  className={
                    j.state === "done"
                      ? "text-sage-600"
                      : j.state === "uploaded"
                        ? "text-blush-600"
                        : j.state === "error"
                          ? "text-blush-700"
                          : "text-stone-500"
                  }
                >
                  {labelFor(j.state)}{j.error ? ` — ${j.error}` : ""}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  {j.itemId && (
                    <Link href={`/wardrobe/${j.itemId}`} className="text-blush-600 hover:underline">Open</Link>
                  )}
                  {(j.state === "queued" || j.state === "error" || j.state === "done" || j.state === "uploaded") && (
                    <button type="button" onClick={() => remove(j.id)} className="text-stone-400 hover:text-stone-700">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {jobs.length === 0 && (
        <div className="card p-10 text-center text-sm text-stone-500">
          Pick a stack of photos to onboard your closet quickly. iPhone Safari supports
          multi-select from the Photo Library.
        </div>
      )}
    </div>
  );
}

function labelFor(state: Job["state"]): string {
  switch (state) {
    case "queued": return "Queued";
    case "processing-heic": return "Converting HEIC…";
    case "uploaded": return "Uploaded — safe to leave";
    case "removing-bg": return "Removing background…";
    case "done": return "Saved with cutout";
    case "error": return "Failed";
  }
}
