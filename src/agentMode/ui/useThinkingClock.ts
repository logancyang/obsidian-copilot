import { useEffect, useRef, useState } from "react";

/**
 * Measure the wall-clock a group spends reasoning, for `summarizeActivity`'s
 * `thought for Xs`. `kind: "thought"` parts carry no timestamps, so the
 * duration has to be observed live, the same way `ReasoningBlock` times its
 * own block. A group can reason several times between tool calls, so spans
 * accumulate rather than restart.
 *
 * @param active - Whether the group is reasoning at this moment; the clock runs
 *   only while this is true and freezes at the value it reached when it drops.
 * @returns Milliseconds spent reasoning so far.
 */
export function useThinkingClock(active: boolean): number {
  const elapsedRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  // Bank the span during render rather than in an effect, so the frame that
  // first sees `active: false` already shows the final duration instead of one
  // stale value. Mutating a ref during render is safe while the result stays
  // deterministic for these inputs.
  if (active && startedAtRef.current === null) {
    startedAtRef.current = Date.now();
  } else if (!active && startedAtRef.current !== null) {
    elapsedRef.current += Date.now() - startedAtRef.current;
    startedAtRef.current = null;
  }

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const startedAt = startedAtRef.current;
  return startedAt === null ? elapsedRef.current : elapsedRef.current + (Date.now() - startedAt);
}
