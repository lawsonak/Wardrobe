"use client";

import { useEffect, useState } from "react";
import { removeBackground, resetBackgroundRemover } from "@/lib/bgRemoval";
import { toast } from "@/lib/toast";

type Pending = {
  id: string;
  imagePath: string;
  category: string;
  subType: string | null;
};

type State = "idle" | "scanning" | "running" | "done" | "error";

export default function BgCleanup() {
  const [items, setItems] = useState<Pending[] | null>(null);
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
      const data = (await res.json()) as { items: Pending[] };
      setItems(data.items);
      setState("idle");
    } catch (err) {
      console.error(err);
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function run() {
    if (!items || items.length === 0) return;
    setState("running");
    setProgress({ done: 0, errors: 0 });
    resetBackgroundRemover();
    let done = 0;
    let errors = 0;
    for (const it of items) {
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
        console.warn("bg cleanup failed for", it.id, err);
        errors++;
      }
      setProgress({ done, errors });
    }
    setState("done");
    toast(`Cleaned up ${done} photo${done === 1 ? "" : "s"}${errors ? ` · ${errors} failed` : ""}`);
    void scan();
  }

  if (state === "scanning" && !items) {
    return <p className="text-sm text-stone-500">Scanning…</p>;
  }
  if (state === "error" && !items) {
    return <p className="text-sm text-blush-700">{message ?? "Couldn't load items."}</p>;
  }

  const total = items?.length ?? 0;

  return (
    <div className="space-y-3">
      {total === 0 ? (
        <p className="text-sm text-stone-500">All photos already have clean backgrounds. ✨</p>
      ) : (
        <p className="text-sm text-stone-600">
          {total} photo{total === 1 ? "" : "s"} could use a clean background.
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
