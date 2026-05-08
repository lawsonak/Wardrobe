"use client";

import { useEffect, useState } from "react";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { toast } from "@/lib/toast";

type PendingItem = {
  id: string;
  imagePath: string;
  category: string;
  subType: string | null;
};

type PendingPhoto = {
  id: string;
  itemId: string;
  imagePath: string;
  kind: string;
  label: string | null;
};

type State = "idle" | "scanning" | "running" | "done" | "error";

export default function BgCleanup() {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[] | null>(null);
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState({ done: 0, errors: 0 });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void scan();
  }, []);

  async function scan() {
    setState("scanning");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/missing-bg");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items: PendingItem[]; photos?: PendingPhoto[] };
      setItems(data.items);
      setPhotos(data.photos ?? []);
      setState("idle");
    } catch (err) {
      console.error(err);
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function run() {
    const itemList = items ?? [];
    const photoList = photos ?? [];
    const total = itemList.length + photoList.length;
    if (total === 0) return;
    setState("running");
    setProgress({ done: 0, errors: 0 });
    resetBackgroundRemover();
    let done = 0;
    let errors = 0;

    // Hero photos first — same flow as before. Each one POSTs
    // `which=bg` to /api/items/[id]/photo to attach the cutout.
    for (const it of itemList) {
      try {
        const photoRes = await fetch(`/api/uploads/${it.imagePath}`);
        if (!photoRes.ok) throw new Error(`load ${photoRes.status}`);
        const blob = await photoRes.blob();
        const out = await removeBackground(blob);
        const fd = new FormData();
        fd.append("which", "bg");
        fd.append("imageBgRemoved", new File([out], "bg.png", { type: "image/png" }));
        const post = await fetch(`/api/items/${it.id}/photo`, { method: "POST", body: fd });
        if (!post.ok) throw new Error(`save ${post.status}`);
        done++;
      } catch (err) {
        console.warn("bg cleanup failed for item", it.id, err);
        errors++;
      }
      setProgress({ done, errors });
    }

    // Then ItemPhoto rows — angles + labels. Same browser-side model,
    // POSTs to the per-photo endpoint with `which=bg` and a multipart
    // body. The server picks the right filename suffix (label-bg /
    // angle-bg) from photo.kind.
    for (const p of photoList) {
      try {
        const photoRes = await fetch(`/api/uploads/${p.imagePath}`);
        if (!photoRes.ok) throw new Error(`load ${photoRes.status}`);
        const blob = await photoRes.blob();
        const out = await removeBackground(blob);
        const fd = new FormData();
        fd.append("which", "bg");
        fd.append("imageBgRemoved", new File([out], "bg.png", { type: "image/png" }));
        const post = await fetch(`/api/items/${p.itemId}/photos/${p.id}`, {
          method: "POST",
          body: fd,
        });
        if (!post.ok) throw new Error(`save ${post.status}`);
        done++;
      } catch (err) {
        console.warn("bg cleanup failed for photo", p.id, err);
        errors++;
      }
      setProgress({ done, errors });
    }

    setState("done");
    toast(`Cleaned up ${done} photo${done === 1 ? "" : "s"}${errors ? ` · ${errors} failed` : ""}`);
    void scan();
  }

  if (state === "scanning" && !items && !photos) {
    return <p className="text-sm text-stone-500">Scanning…</p>;
  }
  if (state === "error" && !items) {
    return <p className="text-sm text-blush-700">{message ?? "Couldn't load items."}</p>;
  }

  const itemCount = items?.length ?? 0;
  const photoCount = photos?.length ?? 0;
  const total = itemCount + photoCount;

  return (
    <div className="space-y-3">
      {total === 0 ? (
        <p className="text-sm text-stone-500">All photos already have clean backgrounds.</p>
      ) : (
        <p className="text-sm text-stone-600">
          {total} photo{total === 1 ? "" : "s"} could use a clean background.
          {(itemCount > 0 || photoCount > 0) && (
            <span className="ml-1 text-xs text-stone-500">
              ({itemCount} hero{itemCount === 1 ? "" : "s"} · {photoCount} angle{photoCount === 1 ? "" : "s"} / label{photoCount === 1 ? "" : "s"})
            </span>
          )}
          {state === "running" && (
            <span className="ml-1 text-xs text-stone-500">
              ({progress.done}/{total} done{progress.errors ? ` · ${progress.errors} failed` : ""})
            </span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          className="btn-secondary"
          disabled={total === 0 || state === "running"}
          title={total === 0 ? "Nothing to do" : "Runs in this tab — keep it open"}
        >
          {state === "running" ? "Cleaning…" : `Clean up ${total} photo${total === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={scan} className="btn-ghost text-stone-600" disabled={state === "running"}>
          Refresh
        </button>
      </div>
      {state === "running" && (
        <p className="text-xs text-stone-500">
          Keep this tab open while we work — backgrounds are removed in your browser to keep things private.
        </p>
      )}
    </div>
  );
}
