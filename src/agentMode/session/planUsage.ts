/**
 * Plan usage — how much of a provider's rolling usage caps the account has spent.
 *
 * Distinct from {@link SessionUsage}, which measures the current session's context
 * occupancy. Caps are per-ACCOUNT and outlive any session: they keep counting across
 * sessions, vaults, and devices, and they are what actually stops a user working.
 *
 * Providers report them in their own shapes, so each backend normalizes its own source
 * into this type and publishes it as a `plan_usage_update`. This module owns the shape
 * every backend agrees on; it knows nothing about any particular provider.
 */

/** One capped window (5-hour, weekly, per-model weekly, ...). */
export interface UsageWindow {
  /** Stable identity, for React keys and for replacing a window on refresh. */
  id: string;
  /** Short label for the meter row: `5h`, `Weekly`, `Weekly (Fable)`. */
  label: string;
  /**
   * Percent of the window consumed, 0–100 and beyond. Values above 100 are real and are
   * not clamped: an account still being served past its cap is genuinely over, and
   * clamping would make "just hit the cap" and "far past it" look identical.
   */
  percent: number;
  /** Epoch milliseconds when the window resets, when the source reports one. */
  resetsAt?: number;
}

export interface PlanUsage {
  windows: UsageWindow[];
  /** Epoch milliseconds when this snapshot was taken. */
  updatedAt: number;
}

/**
 * What a backend learned when it went looking for the account's caps.
 *
 * The three cases exist because "no meters on screen" has two very different causes and
 * only one of them should discard what we already knew. A read that failed tells us
 * nothing, so the previous snapshot stands; a read that succeeded and reported no caps is
 * new information, and leaving the old meters up would state a limit the account no
 * longer has (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 */
export type PlanUsageReading =
  | { kind: "usage"; planUsage: PlanUsage }
  | { kind: "none" }
  | { kind: "unavailable" };

/** Percent, coerced to a finite non-negative number, or null when unusable. */
export function toUsagePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/**
 * Build a reading from the windows a backend managed to normalize.
 *
 * No windows means `unavailable`, never `none`. Only a provider explicitly saying "plan
 * limits do not apply to this account" justifies clearing meters, and a response we could
 * not read is not that statement — it is the absence of one. Erring the other way would
 * let one malformed payload wipe a meter the user was reading.
 */
export function planUsageReading(
  windows: UsageWindow[],
  now: number = Date.now()
): PlanUsageReading {
  if (windows.length === 0) return { kind: "unavailable" };
  return { kind: "usage", planUsage: { windows, updatedAt: now } };
}

/**
 * Drop windows whose reset has already passed, or null when that leaves nothing.
 *
 * A backend process outlives many chats, so a snapshot cached at open can be replayed
 * days later. Once a window has rolled over its percentage describes a period that has
 * ended, and showing it would understate or overstate what the user has left in the
 * window they are actually in (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 * Windows with no reset time are kept: they carry no claim we can falsify.
 */
export function withoutExpiredWindows(
  planUsage: PlanUsage,
  now: number = Date.now()
): PlanUsage | null {
  const windows = planUsage.windows.filter((w) => w.resetsAt === undefined || w.resetsAt > now);
  if (windows.length === 0) return null;
  return windows.length === planUsage.windows.length ? planUsage : { ...planUsage, windows };
}
