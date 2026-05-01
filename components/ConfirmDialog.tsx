"use client";

import { useEffect, useState } from "react";
import { haptic } from "@/lib/haptics";

// In-app confirm dialog. Use `confirmDialog({...})` from any client
// component instead of the browser-native `confirm()` so the destructive
// step matches the design system.

type ConfirmOpts = {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type Pending = ConfirmOpts & { resolve: (v: boolean) => void };

let setPending: ((p: Pending | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!setPending) {
      // Host not mounted (SSR or unmounted) — fall back to native.
      if (typeof window !== "undefined") {
        resolve(window.confirm(`${opts.title}${opts.body ? `\n\n${opts.body}` : ""}`));
      } else {
        resolve(false);
      }
      return;
    }
    setPending({ ...opts, resolve });
  });
}

export default function ConfirmDialogHost() {
  const [pending, setPendingState] = useState<Pending | null>(null);

  useEffect(() => {
    setPending = setPendingState;
    return () => {
      setPending = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter") confirm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function close(value: boolean) {
    if (!pending) return;
    pending.resolve(value);
    setPendingState(null);
  }

  function confirm() {
    haptic(pending?.destructive ? "impact" : "selection");
    close(true);
  }
  function cancel() {
    close(false);
  }

  if (!pending) return null;

  const confirmText = pending.confirmText ?? (pending.destructive ? "Delete" : "Confirm");
  const cancelText = pending.cancelText ?? "Cancel";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-sm sm:items-center"
      onClick={cancel}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5">
          <h2 id="confirm-title" className="font-display text-xl text-stone-800">
            {pending.title}
          </h2>
          {pending.body && (
            <p className="mt-1 text-sm text-stone-600">{pending.body}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
          <button type="button" className="btn-secondary" onClick={cancel} autoFocus>
            {cancelText}
          </button>
          <button
            type="button"
            className={pending.destructive ? "btn bg-blush-600 text-white shadow-card hover:bg-blush-700" : "btn-primary"}
            onClick={confirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
