import { useEffect, useRef, useState } from "react";

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
