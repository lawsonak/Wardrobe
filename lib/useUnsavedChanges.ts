"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ConfirmDialog";

// Guards a workflow against accidental navigation that would discard
// unsaved progress. Pass `dirty=true` while the user has work in
// flight (a photo picked, fields typed, an upload running); pass
// false (or let the component unmount) once it's saved.
//
// Two navigation paths are covered:
//
//   1. Hard navigation — tab close, refresh, typing a new URL,
//      browser back to a non-app page. Uses the standard
//      `beforeunload` event. Browsers force a generic, non-
//      customizable string here — that's a platform limitation, not
//      ours.
//
//   2. In-app navigation — clicking any Next.js <Link> (bottom nav,
//      top nav, breadcrumb, "← Back"). App Router has no
//      route-change-abort API, so we intercept link clicks at the
//      document capture phase, stop the navigation, and show the
//      branded confirmDialog. On confirm we tear the guard down and
//      navigate programmatically.
//
// Not covered: the SPA back/forward button. Re-entrant history
// interception is genuinely bug-prone (double prompts, stuck
// history) and not worth the regression risk — beforeunload still
// catches back-to-outside-the-app.
//
// Escape hatches: a link (or any ancestor) marked
// `data-skip-unsaved-guard` is never intercepted — use it on the
// form's own "Cancel" / "Discard" affordance if it should bypass
// the prompt.
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  // Mirror `dirty` into a ref so the long-lived listeners always see
  // the latest value without re-binding on every keystroke.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Legacy browsers need returnValue set to a (now ignored) string.
      e.returnValue = "";
    }

    function onClickCapture(e: MouseEvent) {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      // Only plain left-clicks — let cmd/ctrl/shift/middle-click
      // (open in new tab/window) through untouched.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // New tab / download / in-page anchor → not a progress-losing
      // navigation, leave alone.
      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      // External origin → beforeunload handles it; don't double-prompt.
      if (url.origin !== window.location.origin) return;
      // Same page (query/hash-only) → no progress lost.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      // Explicit opt-out.
      if (anchor.closest("[data-skip-unsaved-guard]")) return;

      e.preventDefault();
      e.stopPropagation();
      const dest = url.pathname + url.search + url.hash;
      void (async () => {
        const ok = await confirmDialog({
          title: "Leave this page?",
          body: "By leaving you'll lose any progress you haven't saved. Are you sure?",
          confirmText: "Leave",
          cancelText: "Stay",
          destructive: true,
        });
        if (ok) {
          // Stop guarding before we navigate so the programmatic
          // push doesn't re-trigger the prompt, then go.
          dirtyRef.current = false;
          router.push(dest);
        }
      })();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    // Capture phase so we win the click before Next's <Link> onClick
    // (which runs in the bubble phase) gets to start its navigation.
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [router]);
}
