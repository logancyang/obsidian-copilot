import { useEffect, useRef, useState } from "react";

/**
 * Measure only the group's active reasoning span. Completed spans are frozen
 * on their thought parts by the session store, so a batched React render
 * cannot skip them.
 *
 * @param active - Whether the group is reasoning at this moment.
 * @param startedAtMs - Event time for the active thought's first chunk.
 * @returns Milliseconds spent in the current reasoning span.
 */
export function useThinkingClock(active: boolean, startedAtMs?: number): number {
  const fallbackStartedAtRef = useRef(Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return 0;
  return Math.max(0, Date.now() - (startedAtMs ?? fallbackStartedAtRef.current));
}
