"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, type Category } from "@/lib/constants";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { heicToJpeg, isHeic } from "@/lib/heic";

type Job = {
  id: string;             // local id
  file: File;             // original (possibly HEIC-converted) file
  previewUrl: string;
  bgUrl?: string;
  state: "queued" | "processing-heic" | "removing-bg" | "uploading" | "done" | "error";
  error?: string;
  itemId?: string;        // server id once uploaded
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

  // Revoke object URLs when jobs are dropped.
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

  async function processJob(job: Job): Promise<Job> {
    let { file } = job;
    let local = job;

    if (isHeic(file)) {
      update(local.id, { state: "processing-heic" });
      try {
        file = await heicToJpeg(file);
      } catch (err) {
        console.error(err);
        update(local.id, { state: "error", error: "HEIC conversion failed" });
        return { ...local, state: "error", error: "HEIC conversion failed" };
      }
      const newPreview = URL.createObjectURL(file);
      if (local.previewUrl) URL.revokeObjectURL(local.previewUrl);
      update(local.id, { file, previewUrl: newPreview });
      local = { ...local, file, previewUrl: newPreview };
    }

    let bgBlob: Blob | null = null;
    if (removeBg) {
      update(local.id, { state: "removing-bg" });
      try {
        bgBlob = await removeBackground(file);
        const url = URL.createObjectURL(bgBlob);
        update(local.id, { bgUrl: url });
        local = { ...local, bgUrl: url };
      } catch (err) {
        console.error("bg removal failed", err);
        // Fall through and just upload the original.
        bgBlob = null;
      }
    }

    update(local.id, { state: "uploading" });
    const fd = new FormData();
    fd.append("image", file);
    if (bgBlob) fd.append("imageBgRemoved", new File([bgBlob], "bg.png", { type: "image/png" }));
    fd.append("category", defaultCategory);
    fd.append("status", defaultStatus);

    try {
      const res = await fetch("/api/items", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as { item?: { id: string } };
      update(local.id, { state: "done", itemId: d.item?.id });
      return { ...local, state: "done", itemId: d.item?.id };
    } catch (err) {
      console.error(err);
      update(local.id, { state: "error", error: "Upload failed" });
      return { ...local, state: "error", error: "Upload failed" };
    }
  }

  async function runAll() {
    if (running) return;
    setRunning(true);
    // Snapshot the queued list so jobs added mid-run also get picked up
    // by re-running. We loop a queue here so failures don't block others.
    const snapshot = jobs.filter((j) => j.state === "queued" || j.state === "error");
    let completed = 0;
    for (const j of snapshot) {
      const result = await processJob(j);
      if (result.state === "done") completed++;
    }
    setRunning(false);
    // Surface a success toast via the notification bell.
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Batch upload complete`,
          body: `${completed} item${completed === 1 ? "" : "s"} added${defaultStatus === "needs_review" ? ", waiting for review" : ""}.`,
          href: defaultStatus === "needs_review" ? "/wardrobe/needs-review" : "/wardrobe",
        }),
      });
    } catch {
      /* ignore — notifications are best-effort */
    }
    router.refresh();
  }

  const counts = jobs.reduce(
    (acc, j) => {
      acc.total++;
      if (j.state === "done") acc.done++;
      else if (j.state === "error") acc.error++;
      else if (j.state !== "queued") acc.running++;
      return acc;
    },
    { total: 0, done: 0, error: 0, running: 0 },
  );

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
          Remove backgrounds (slower, prettier)
        </label>
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
          onClick={runAll}
          className="btn-secondary"
          disabled={running || jobs.filter((j) => j.state === "queued" || j.state === "error").length === 0}
        >
          {running ? "Uploading…" : `Upload ${jobs.filter((j) => j.state === "queued").length || jobs.length} photo${jobs.length === 1 ? "" : "s"}`}
        </button>
        {jobs.some((j) => j.state === "error") && (
          <button
            type="button"
            onClick={async () => { resetBackgroundRemover(); await runAll(); }}
            className="btn-ghost text-blush-600"
            disabled={running}
          >
            Retry failed
          </button>
        )}
        {counts.total > 0 && (
          <span className="text-xs text-stone-500">
            {counts.done}/{counts.total} done{counts.error ? ` · ${counts.error} failed` : ""}
          </span>
        )}
      </div>

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
                <p className={
                  j.state === "done"
                    ? "text-sage-600"
                    : j.state === "error"
                      ? "text-blush-700"
                      : "text-stone-500"
                }>
                  {labelFor(j.state)}{j.error ? ` — ${j.error}` : ""}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  {j.itemId && (
                    <Link href={`/wardrobe/${j.itemId}`} className="text-blush-600 hover:underline">Open</Link>
                  )}
                  {(j.state === "queued" || j.state === "error" || j.state === "done") && (
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
    case "removing-bg": return "Removing background…";
    case "uploading": return "Uploading…";
    case "done": return "Saved";
    case "error": return "Failed";
  }
}
