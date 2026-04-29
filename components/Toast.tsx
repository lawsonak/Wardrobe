"use client";

import { useEffect, useState } from "react";
import { subscribe, type ToastMessage } from "@/lib/toast";
import { cn } from "@/lib/cn";

const VISIBLE_MS = 2400;

export default function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribe((msg) => {
      setItems((prev) => [...prev, msg]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((m) => m.id !== msg.id));
      }, VISIBLE_MS);
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex flex-col items-center gap-2 px-4 sm:bottom-8"
    >
      {items.map((m) => (
        <div
          key={m.id}
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-card ring-1 backdrop-blur",
            m.kind === "success" && "bg-blush-600 text-white ring-blush-500",
            m.kind === "error" && "bg-white text-blush-700 ring-blush-200",
            m.kind === "info" && "bg-white text-stone-700 ring-stone-200",
          )}
          role={m.kind === "error" ? "alert" : "status"}
        >
          {m.kind === "success" && (
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 7" />
            </svg>
          )}
          {m.kind === "error" && (
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.5h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4.99c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3Z" />
            </svg>
          )}
          <span>{m.text}</span>
        </div>
      ))}
    </div>
  );
}
