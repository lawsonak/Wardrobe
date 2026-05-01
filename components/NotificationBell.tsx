"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

const POLL_MS = 60_000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [pulse, setPulse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastUnreadRef = useRef(0);
  const initialLoadRef = useRef(true);

  async function load() {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: Notification[]; unread: number };
      setList(data.notifications);
      setUnread(data.unread);
      // Pulse the badge briefly when new unread notifications arrive after
      // the first load — gentle hint without being noisy.
      if (!initialLoadRef.current && data.unread > lastUnreadRef.current) {
        setPulse(true);
        window.setTimeout(() => setPulse(false), 2000);
      }
      lastUnreadRef.current = data.unread;
      initialLoadRef.current = false;
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    function onVisibility() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function markAllRead() {
    setUnread(0);
    setList((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
  }

  async function markRead(id: string) {
    setList((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
  }

  async function dismiss(id: string) {
    setList((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn-icon relative"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5">
            {pulse && (
              <span className="absolute inset-0 -m-0.5 animate-ping rounded-full bg-blush-400 opacity-75" />
            )}
            <span className="relative grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-blush-500 px-1 text-[10px] font-semibold text-white ring-2 ring-cream-50">
              {unread > 9 ? "9+" : unread}
            </span>
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-30 bg-stone-900/30 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className={cn(
              "z-40 overflow-hidden bg-white shadow-card ring-1 ring-stone-100",
              // Mobile: full-width sheet anchored to bottom
              "fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              // Desktop: dropdown anchored to the bell
              "sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:mt-2 sm:w-80 sm:rounded-2xl sm:pb-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 sm:px-3 sm:py-2">
              <p className="text-sm font-medium text-stone-700">Notifications</p>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-blush-600 hover:underline">
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="text-stone-400 hover:text-stone-700 sm:hidden"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-stone-500">All caught up.</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-stone-100 overflow-auto">
                {list.map((n) => (
                  <li key={n.id} className={"flex items-start gap-2 px-4 py-3 text-sm sm:px-3 sm:py-2 " + (n.read ? "" : "bg-blush-50/40")}>
                    <span className={"mt-1 h-2 w-2 shrink-0 rounded-full " + (n.read ? "bg-stone-200" : "bg-blush-500")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => {
                            setOpen(false);
                            if (!n.read) markRead(n.id);
                          }}
                          className="block"
                        >
                          <p className="truncate font-medium text-stone-800">{n.title}</p>
                          {n.body && <p className="truncate text-xs text-stone-500">{n.body}</p>}
                        </Link>
                      ) : (
                        <>
                          <p className="truncate font-medium text-stone-800">{n.title}</p>
                          {n.body && <p className="truncate text-xs text-stone-500">{n.body}</p>}
                        </>
                      )}
                      <p className="mt-0.5 text-[10px] text-stone-400">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="text-stone-400 hover:text-stone-700"
                      aria-label="Dismiss notification"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
