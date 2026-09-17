import { buildAgentMemorySkeleton } from "@/agents/agentFile";
import {
  boundConsolidationNotes,
  buildAgentMemoryConsolidationPrompt,
  formatMemoryEntryDate,
  previousMemoryDay,
  reviewMemoryUpdate,
  type MemoryUpdateRejection,
} from "@/agents/agentMemory";
import type { AgentMemoryPassDeps } from "@/agentMode/session/agentMemoryPass";
import type { BackendId } from "@/agentMode/session/types";
import { logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";

/** One agent's consolidation: which agent, and which backend it thinks on. */
export interface AgentMemoryConsolidationRequest {
  /** Agent whose `MEMORY.md` is being rewritten. */
  agentSlug: string;
  /** Backend to run on when the agent pins none of its own. */
  sessionBackendId: BackendId;
  /** Aborts the sub-session; the pass then reports `failed`. */
  signal: AbortSignal;
  /** Clock, passed in so the date the prompt stamps entries with is testable. */
  now?: Date;
}

/** What a finished consolidation did. */
export type AgentMemoryConsolidationOutcome =
  | { status: "written"; agentName: string; memoryPath: string; consolidatedThrough: string }
  /** Nothing to do: not an agent with memory, or no note newer than the marker. */
  | { status: "skipped"; reason: "no-agent" | "memory-off" | "no-new-notes" }
  /** The safety rails refused what came back; the old file stands. */
  | { status: "rejected"; reason: MemoryUpdateRejection }
  /** The user edited `MEMORY.md` while the pass ran; their version is the baseline. */
  | { status: "conflict" }
  | { status: "failed"; error: string };

/**
 * Rewrite one agent's curated `MEMORY.md` from the daily notes it has not
 * folded in yet.
 *
 * This is the only writer of that file besides the user, which is what lets the
 * agent's own in-turn notes be appended freely: nothing has to be careful about
 * the core, because the core is rebuilt from the notes. The user's edits are
 * always the new baseline — the file's content hash is captured with the input
 * and re-checked at the write, so an edit made while the pass was thinking
 * discards the result rather than overwriting it. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Consolidation", "Safety rails").
 *
 * Never throws: the caller is an idle timer or a menu item, neither of which
 * can act on a failure beyond logging it.
 *
 * @param deps - The agent folder reader and the sub-session runner.
 * @param request - Which agent, on which backend.
 */
export async function runAgentMemoryConsolidation(
  deps: AgentMemoryPassDeps,
  request: AgentMemoryConsolidationRequest
): Promise<AgentMemoryConsolidationOutcome> {
  try {
    const record = await deps.files.readAgent(request.agentSlug);
    if (!record) return { status: "skipped", reason: "no-agent" };
    const { agent } = record;
    if (!agent.memoryEnabled) return { status: "skipped", reason: "memory-off" };

    const stored = await deps.files.readMemoryDocument(agent.slug);
    // A hand-deleted memory file leaves the agent with the skeleton it started
    // life with, so the pass always has the fixed headings to revise.
    const currentMemory = stored?.body.trim() || buildAgentMemorySkeleton(agent.name);
    const expectedHash = stored?.hash ?? null;

    const today = formatMemoryEntryDate(request.now ?? new Date());
    const pending = await deps.files.readDailyNotesAfter(
      agent.slug,
      readNotesAfter(stored?.consolidatedThrough ?? null, today)
    );
    if (pending.length === 0) return { status: "skipped", reason: "no-new-notes" };
    // The marker advances to the newest note that EXISTS, not the newest one
    // read: dropping an over-budget old day must not leave it to be re-read
    // forever, and the notes themselves stay on disk either way.
    const consolidatedThrough = pending[pending.length - 1].date;
    const notes = boundConsolidationNotes(pending);

    const prompt = buildAgentMemoryConsolidationPrompt({
      agentName: agent.name,
      currentMemory,
      notes,
      today: request.now ?? new Date(),
    });

    let returned = "";
    const outcome = await deps.subSessions.run({
      backendId: agent.backendId || request.sessionBackendId,
      prompt: [{ type: "text", text: prompt }],
      signal: request.signal,
      onText: (text) => {
        returned += text;
      },
    });
    if (outcome === "aborted") return { status: "failed", error: "Consolidation was cancelled." };

    const review = reviewMemoryUpdate(currentMemory, returned);
    if (!review.accepted) {
      // Logged, never shown: the file is unchanged, so there is nothing the
      // user could act on (`designdocs/CUSTOM_AGENTS.md` §5, "Safety rails").
      logWarn(
        `[Agents] Rejected a consolidation for "${agent.slug}" (${review.reason}); keeping the existing file`
      );
      return { status: "rejected", reason: review.reason };
    }

    const written = await deps.files.writeConsolidatedMemory(
      agent.slug,
      review.text,
      consolidatedThrough,
      expectedHash
    );
    if (written === "conflict") {
      logInfo(
        `[Agents] Discarded a consolidation for "${agent.slug}": MEMORY.md changed while it ran`
      );
      return { status: "conflict" };
    }

    logInfo(`[Agents] Consolidated memory at ${record.memoryPath} through ${consolidatedThrough}`);
    return {
      status: "written",
      agentName: agent.name,
      memoryPath: record.memoryPath,
      consolidatedThrough,
    };
  } catch (error) {
    logWarn(`[Agents] Consolidation failed for "${request.agentSlug}"`, error);
    return { status: "failed", error: err2String(error) };
  }
}

/**
 * The day consolidation reads forward from, which is not always the marker.
 *
 * `consolidated-through` records the last day folded in, but a day still being
 * written to is never finished: after the first consolidation of the day, a
 * second conversation's notes would otherwise sit unread until tomorrow. So a
 * marker that has reached today reads as the day before, and today's note is
 * folded in again — the prompt already merges what it has seen before.
 * See `designdocs/CUSTOM_AGENTS.md` §5 ("Consolidation").
 *
 * @param consolidatedThrough - Marker from `MEMORY.md`, or null when never run.
 * @param today - Today's date as `YYYY-MM-DD`.
 */
export function readNotesAfter(consolidatedThrough: string | null, today: string): string | null {
  if (!consolidatedThrough) return null;
  return consolidatedThrough >= today ? previousMemoryDay(today) : consolidatedThrough;
}

/**
 * Whether this agent has a daily note its `MEMORY.md` has not folded in yet —
 * the condition every automatic consolidation trigger is gated on.
 *
 * Reads only the folder listing and the marker, so the idle timer can ask about
 * every agent without touching a backend
 * (`designdocs/CUSTOM_AGENTS.md` §5, "Consolidation").
 *
 * @param files - Reader for the agent folder.
 * @param slug - Identity of the agent to check.
 */
export async function hasUnconsolidatedNotes(
  files: AgentMemoryPassDeps["files"],
  slug: string
): Promise<boolean> {
  const dates = files.listDailyNoteDates(slug);
  if (dates.length === 0) return false;
  const stored = await files.readMemoryDocument(slug);
  if (!stored?.consolidatedThrough) return true;
  const newestDate = dates[dates.length - 1];
  if (newestDate > stored.consolidatedThrough) return true;
  // The marker has reached the newest day, but that day may have been appended
  // to since the core was written. A note newer than `MEMORY.md` is work the
  // core has not seen; anything older is already in it, so an idle plugin does
  // not consolidate the same day over and over.
  const newest = await files.readDailyNote(slug, newestDate);
  return newest !== null && newest.modifiedAtMs > stored.modifiedAtMs;
}
