"use client";

import { useEffect, useState } from "react";

// Time-based "fake" progress for operations that don't expose
// streaming progress (Gemini calls). Bar eases to ~`ceiling` over
// `expectedSeconds` and never reaches 100% on its own — call sites
// snap to 1.0 when the underlying operation actually resolves.
//
// Curve: 1 - exp(-t / tau) capped at ceiling. Looks responsive at
// the start, slows down as it approaches the cap, never overshoots.
export function useTimedProgress(
  running: boolean,
  expectedSeconds = 15,
  ceiling = 0.95,
): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!running) {
      // Reset to 0 next time the operation starts.
      setValue(0);
      return;
    }
    const start = Date.now();
    // tau = expectedSeconds / -ln(1 - ceiling) gives us ceiling at
    // expectedSeconds elapsed.
    const tau = expectedSeconds / -Math.log(1 - ceiling);
    let frame = 0;
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000;
      const v = ceiling * (1 - Math.exp(-elapsed / tau));
      setValue(v);
      frame = window.setTimeout(tick, 200) as unknown as number;
    };
    tick();
    return () => {
      if (frame) window.clearTimeout(frame);
    };
  }, [running, expectedSeconds, ceiling]);

  return value;
}
