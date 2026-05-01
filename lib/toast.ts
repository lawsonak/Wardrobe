"use client";

// Tiny client-only toast bus. The provider in components/Toast.tsx
// subscribes; call `toast("Saved")` from anywhere in client code.

export type ToastKind = "success" | "error" | "info";
export type ToastMessage = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Listener = (msg: ToastMessage) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function toast(text: string, kind: ToastKind = "success") {
  const msg: ToastMessage = { id: nextId++, kind, text };
  for (const l of listeners) l(msg);
  return msg.id;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
