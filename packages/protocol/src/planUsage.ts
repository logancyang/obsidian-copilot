export interface UsageWindow {
  id: string;
  label: string;
  percent: number;
  resetsAt?: number;
}

export interface PlanUsage {
  windows: UsageWindow[];
  updatedAt: number;
}

/**
 * A failed read keeps the previous snapshot; a successful read that reports no caps
 * discards it, so the meters never state a limit the account no longer has.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/193
 */
export type PlanUsageReading =
  | { kind: "usage"; planUsage: PlanUsage }
  | { kind: "none" }
  | { kind: "unavailable" };

export function toUsagePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

export function planUsageReading(
  windows: UsageWindow[],
  now: number = Date.now()
): PlanUsageReading {
  if (windows.length === 0) return { kind: "unavailable" };
  return { kind: "usage", planUsage: { windows, updatedAt: now } };
}

/**
 * Drop windows whose reset has passed: a cached snapshot replayed days later describes
 * an ended period. Windows with no reset time are kept.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/193
 */
export function withoutExpiredWindows(
  planUsage: PlanUsage,
  now: number = Date.now()
): PlanUsage | null {
  const windows = planUsage.windows.filter((w) => w.resetsAt === undefined || w.resetsAt > now);
  if (windows.length === 0) return null;
  return windows.length === planUsage.windows.length ? planUsage : { ...planUsage, windows };
}
