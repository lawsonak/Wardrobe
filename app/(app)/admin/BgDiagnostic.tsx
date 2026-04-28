"use client";

import { useState } from "react";
import { removeBackground, currentPublicPath, resetBackgroundRemover } from "@/lib/bgRemoval";

type Step = { name: string; status: "pending" | "ok" | "error"; detail?: string };

// Generate a tiny solid-color PNG entirely client-side so we don't depend
// on any seed asset. 64x64, opaque, ~150 bytes.
async function makeTestPng(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.fillStyle = "#dde";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#a83";
  ctx.beginPath();
  ctx.arc(32, 32, 20, 0, Math.PI * 2);
  ctx.fill();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export default function BgDiagnostic() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  function setStep(name: string, status: Step["status"], detail?: string) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.name === name);
      const next = idx >= 0 ? [...prev] : [...prev, { name, status, detail }];
      if (idx >= 0) next[idx] = { name, status, detail };
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setSteps([]);
    resetBackgroundRemover();

    // 1. Module load
    setStep("Load /vendor/imgly/index.mjs", "pending");
    try {
      const r = await fetch("/vendor/imgly/index.mjs", { method: "HEAD" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStep("Load /vendor/imgly/index.mjs", "ok", `${r.headers.get("content-length") ?? "?"} bytes`);
    } catch (err) {
      setStep("Load /vendor/imgly/index.mjs", "error", String(err));
      setRunning(false);
      return;
    }

    // 2. Local resources.json
    setStep("Local resources.json", "pending");
    let localOk = false;
    try {
      const r = await fetch("/vendor/imgly/resources.json", { cache: "no-store" });
      if (r.ok) {
        localOk = true;
        setStep("Local resources.json", "ok", "found — will use local model");
      } else {
        setStep("Local resources.json", "error", `HTTP ${r.status} — will fall back to CDN`);
      }
    } catch (err) {
      setStep("Local resources.json", "error", `${err} — will fall back to CDN`);
    }

    // 3. CDN reachability (if we'll need it)
    if (!localOk) {
      setStep("CDN reachable", "pending");
      try {
        const r = await fetch(
          `https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/resources.json`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setStep("CDN reachable", "ok");
      } catch (err) {
        setStep("CDN reachable", "error", `${err} — both local and CDN failed`);
        setRunning(false);
        return;
      }
    }

    // 4. Cross-origin isolation check (needed for ONNX threaded WASM)
    setStep("Cross-origin isolated", "pending");
    if (typeof window !== "undefined" && window.crossOriginIsolated) {
      setStep("Cross-origin isolated", "ok", "threaded WASM available");
    } else {
      setStep(
        "Cross-origin isolated",
        "error",
        "page not isolated — bg removal will use slower single-threaded WASM. (Restart the service after the latest deploy to pick up COOP/COEP headers.)",
      );
    }

    // 5. End-to-end run on a generated test PNG
    setStep("Test removal", "pending");
    try {
      const png = await makeTestPng();
      const out = await removeBackground(png);
      setStep("Test removal", "ok", `${out.size} bytes returned · using ${currentPublicPath() ?? "unknown"}`);
    } catch (err) {
      setStep("Test removal", "error", err instanceof Error ? err.message : String(err));
    }

    setRunning(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={run} className="btn-secondary" disabled={running}>
          {running ? "Running diagnostics…" : "Run diagnostics"}
        </button>
        <p className="text-xs text-stone-500">
          Probes the model load path end-to-end with a tiny test image.
        </p>
      </div>
      {steps.length > 0 && (
        <ul className="rounded-xl bg-cream-100 p-3 text-sm">
          {steps.map((s) => (
            <li key={s.name} className="flex items-start gap-2 py-1">
              <span
                className={
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white " +
                  (s.status === "ok"
                    ? "bg-sage-400"
                    : s.status === "error"
                      ? "bg-blush-500"
                      : "bg-stone-300")
                }
                aria-hidden
              >
                {s.status === "ok" ? "✓" : s.status === "error" ? "!" : "…"}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-stone-800">{s.name}</p>
                {s.detail && <p className="text-xs text-stone-500">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
