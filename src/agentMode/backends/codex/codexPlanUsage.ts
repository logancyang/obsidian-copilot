import { requireNodeModule } from "@/utils/desktopRuntime";
import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import {
  planUsageReading,
  toUsagePercent,
  withoutExpiredWindows,
} from "@/agentMode/session/planUsage";
import { logInfo } from "@/logger";

/**
 * Codex's plan caps do not cross the ACP wire.
 *
 * `codex-acp` receives them from Codex as an `account/rateLimits/updated` notification,
 * stores them on its own session state, and returns null instead of forwarding a session
 * update — verified in the shipped bundles of both 1.1.7 and 1.3.0. Its only exposure is
 * the `/status` slash command, which renders them as prose into the conversation.
 *
 * Codex itself writes them to disk, though: every turn appends a `token_count` event to
 * the session's rollout file under `CODEX_HOME/sessions/`, and that event carries the
 * `rate_limits` object verbatim. Reading the newest one back is the only structured
 * source available to a client, so that is what this module does. The snapshot's shape
 * is Codex's own, so its normalizer lives here beside the reader, the way the Claude
 * normalizer lives with the SDK adapter that knows its shape.
 *
 * It is an undocumented internal format and it may change without notice. Every failure
 * — a moved directory, a renamed field, a file we cannot read — reads as "unavailable",
 * which the caller treats as no news and leaves the previous meters standing. A rollout
 * can never affirm that an account is unmetered, so this source never clears them
 * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 */

/** One window of a Codex rate-limit snapshot. */
interface CodexWindow {
  used_percent?: number | null;
  window_minutes?: number | null;
  resets_at?: number | null;
}

/**
 * The `rate_limits` object Codex records against a turn.
 *
 * The two slots are positional, not named windows: which durations they hold depends on
 * the plan. A Pro account reports a single weekly window in `primary` and leaves
 * `secondary` empty; plans with a shorter burst window put that in `primary` and the
 * weekly one in `secondary`.
 */
export interface CodexRateLimits {
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
}

/**
 * Name a Codex window by how long it is, because Codex reports a duration where the other
 * providers report a named bucket. Weekly is spelled out to match what the other meters
 * call it; anything else reads as its own duration.
 */
function codexWindowLabel(minutes: unknown): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.round(minutes)}m`;
}

/**
 * Epoch milliseconds from Codex's epoch SECONDS, or undefined when unusable. Providers
 * disagree on encoding — Claude sends ISO 8601, Codex seconds — so each adapter converts
 * its own.
 */
function epochSecondsToMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000);
}

/** The slots Codex can fill, in the order they should be shown. */
const CODEX_WINDOWS = ["primary", "secondary"] as const;

/**
 * Normalize a Codex rate-limit snapshot.
 *
 * A slot the plan does not cap is empty rather than zero, and a snapshot that yields no
 * usable slot is indistinguishable from one we failed to read, so it reports unavailable
 * — never "0% used", and never a reason to clear a meter. Percentages pass through
 * unclamped for the same reason as every other source.
 */
export function planUsageFromCodexRateLimits(
  limits: CodexRateLimits | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  const windows: UsageWindow[] = [];
  for (const id of CODEX_WINDOWS) {
    const raw = limits?.[id];
    const percent = toUsagePercent(raw?.used_percent);
    const label = codexWindowLabel(raw?.window_minutes);
    if (percent === null || label === null) continue;
    windows.push({ id, label, percent, resetsAt: epochSecondsToMs(raw?.resets_at) });
  }
  return planUsageReading(windows, now);
}

/**
 * How many day-directories back to look for the newest rollout.
 *
 * Rollouts are filed under the date the session STARTED, so a long-lived session keeps
 * appending to the directory of the day it opened while newer-dated directories fill
 * with other files. A week covers any session Obsidian realistically keeps alive; the
 * file is then chosen by modification time, not by which directory it sits in.
 */
const RECENT_DAY_DIRS = 7;

/**
 * How many rollouts, newest-written first, to inspect before giving up.
 *
 * The newest file can legitimately hold no rate limits yet — a session that just opened
 * has only its metadata written — and on a fresh plugin start there is no in-memory
 * snapshot to fall back on, so stopping at the first file would show no caps until a
 * turn ran. A burst of just-opened sessions is the only way several limitless files
 * stack up, so a handful of candidates finds the last recorded snapshot while keeping
 * the read bounded.
 */
const MAX_ROLLOUT_CANDIDATES = 8;

/**
 * How much of the rollout tail to read. Rollouts grow to megabytes and this runs at every
 * turn boundary, so it reads the end rather than the file: `token_count` events are
 * appended throughout a turn, and the most recent one is what we want anyway.
 */
const TAIL_BYTES = 256 * 1024;

// Codex state only exists on desktop, where Agent Mode runs; the lazy accessors keep
// Node built-ins off the mobile load path (see desktopRuntime.requireNodeModule).
function nodeFs(): typeof import("node:fs") {
  return requireNodeModule<typeof import("node:fs")>("fs");
}
function nodePath(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}

/** Where Codex keeps its state when the environment does not say otherwise. */
export function defaultCodexHome(): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return nodePath().join(os.homedir(), ".codex");
}

/**
 * The account's plan-cap utilization as of Codex's last recorded turn.
 *
 * The snapshot is account-scoped, so the newest rollout on disk answers for every session
 * — including turns the user ran in their own terminal, which are spending the same caps.
 */
export async function readCodexPlanUsage(codexHome: string): Promise<PlanUsageReading> {
  try {
    const dirs = await recentDayDirs(nodePath().join(codexHome, "sessions"), RECENT_DAY_DIRS);
    const rollouts = await rolloutsByRecency(dirs);
    for (const rollout of rollouts.slice(0, MAX_ROLLOUT_CANDIDATES)) {
      const limits = lastRateLimits(await readTail(rollout));
      // A just-opened session's rollout holds only its metadata; the account's last
      // recorded snapshot is in the next-newest file, not nowhere.
      if (!limits) continue;
      const reading = planUsageFromCodexRateLimits(limits);
      if (reading.kind !== "usage") return reading;
      // A disk snapshot can be arbitrarily old. A window whose recorded reset has
      // passed describes a finished period — after a long idle it would present the
      // previous week's percentage as current — and an older rollout would only be
      // staler, so there is nothing better to fall back to
      // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
      const current = withoutExpiredWindows(reading.planUsage);
      return current ? { kind: "usage", planUsage: current } : { kind: "unavailable" };
    }
    logInfo("[AgentMode] no Codex rollout carries rate limits; plan caps unavailable");
    return { kind: "unavailable" };
  } catch (error) {
    logInfo("[AgentMode] Codex plan cap read failed; plan caps unavailable", error);
    return { kind: "unavailable" };
  }
}

/**
 * The most recent day-directories under `sessions/`, newest first.
 *
 * The tree is `YYYY/MM/DD` with zero-padded names, so descending lexicographic order is
 * descending chronological order, and walking it that way crosses month and year
 * boundaries without any date arithmetic.
 */
async function recentDayDirs(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  for (const year of await descendingSubdirs(root)) {
    for (const month of await descendingSubdirs(nodePath().join(root, year))) {
      for (const day of await descendingSubdirs(nodePath().join(root, year, month))) {
        out.push(nodePath().join(root, year, month, day));
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** Subdirectory names of `dir`, newest-looking first; empty when it cannot be listed. */
async function descendingSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await nodeFs().promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Every rollout across `dirs`, most recently written first. */
async function rolloutsByRecency(dirs: string[]): Promise<string[]> {
  const rollouts: { file: string; mtimeMs: number }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await nodeFs().promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const file = nodePath().join(dir, name);
      try {
        const stat = await nodeFs().promises.stat(file);
        rollouts.push({ file, mtimeMs: stat.mtimeMs });
      } catch {
        // Raced with Codex archiving or deleting the session; the next one will do.
      }
    }
  }
  return rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs).map((rollout) => rollout.file);
}

/** The last {@link TAIL_BYTES} of `file` as whole lines. */
async function readTail(file: string): Promise<string> {
  const handle = await nodeFs().promises.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf-8");
    if (start === 0) return text;
    // Starting mid-file cuts a line in half; drop it rather than parse a fragment.
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

/** The rate limits from the newest event in `tail` that carries them. */
export function lastRateLimits(tail: string): CodexRateLimits | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(line) as { payload?: { rate_limits?: CodexRateLimits | null } };
      const limits = event.payload?.rate_limits;
      if (limits) return limits;
    } catch {
      // Not JSON we understand — an event shape we do not read, or a truncated line.
    }
  }
  return null;
}
