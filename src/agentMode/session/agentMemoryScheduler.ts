/**
 * How long a chat must sit untouched after a turn before its new turns are
 * flushed to its agent's daily note.
 *
 * Long enough that a pause for thought inside one exchange does not split it
 * across two headings, short enough that a chat left open all afternoon has its
 * notes on disk before the user asks another chat what was said. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Daily notes").
 */
export const AGENT_MEMORY_FLUSH_IDLE_MS = 2 * 60_000;

/**
 * How long every agent chat must be quiet before consolidation runs.
 *
 * Consolidation reads a day of notes and rewrites a file, so it waits for a gap
 * the user is unlikely to be inside rather than competing with a conversation
 * for the backend (`designdocs/CUSTOM_AGENTS.md` §5, "Consolidation").
 */
export const AGENT_MEMORY_CONSOLIDATION_IDLE_MS = 10 * 60_000;

/** What the scheduler sets off when a window of quiet elapses. */
export interface AgentMemorySchedulerHooks {
  /** Fold one chat's new turns into its agent's daily note. */
  flushChat(internalId: string): void;
  /** Consolidate every agent that has notes its `MEMORY.md` has not folded in. */
  consolidate(): void;
}

/** Overridable windows, so tests can drive both timers without long waits. */
export interface AgentMemorySchedulerOptions {
  flushIdleMs?: number;
  consolidationIdleMs?: number;
}

/**
 * Turns "the user stopped typing" into the two background memory passes.
 *
 * It owns only timing: which chat has been quiet long enough to flush, and
 * whether the plugin as a whole has been quiet long enough to consolidate.
 * Whether there is anything to write is the passes' own decision, so this stays
 * free of file and backend knowledge and is testable on fake timers. See
 * `designdocs/CUSTOM_AGENTS.md` §5.
 */
export class AgentMemoryScheduler {
  private readonly flushTimers = new Map<string, number>();
  private consolidationTimer: number | null = null;
  /** Chats with a turn in flight. Consolidation waits for this to empty. */
  private readonly running = new Set<string>();

  private readonly flushIdleMs: number;
  private readonly consolidationIdleMs: number;

  constructor(
    private readonly hooks: AgentMemorySchedulerHooks,
    options: AgentMemorySchedulerOptions = {}
  ) {
    this.flushIdleMs = options.flushIdleMs ?? AGENT_MEMORY_FLUSH_IDLE_MS;
    this.consolidationIdleMs = options.consolidationIdleMs ?? AGENT_MEMORY_CONSOLIDATION_IDLE_MS;
  }

  /**
   * A turn started in this chat. Both windows restart: the chat is in use, and
   * so is the plugin.
   *
   * @param internalId - The chat whose turn began.
   */
  noteTurnStarted(internalId: string): void {
    this.running.add(internalId);
    this.cancelFlush(internalId);
    this.cancelConsolidation();
  }

  /**
   * A turn ended in this chat. Arms its flush, and arms consolidation once no
   * chat is mid-turn.
   *
   * @param internalId - The chat whose turn settled.
   */
  noteTurnEnded(internalId: string): void {
    this.running.delete(internalId);
    this.cancelFlush(internalId);
    this.flushTimers.set(
      internalId,
      window.setTimeout(() => {
        this.flushTimers.delete(internalId);
        this.hooks.flushChat(internalId);
      }, this.flushIdleMs)
    );
    this.armConsolidation();
  }

  /**
   * Drop a chat's pending flush, because something else already ended its
   * conversation — it was closed, or it flushed at a boundary.
   *
   * @param internalId - The chat to stop waiting on.
   */
  cancelFlush(internalId: string): void {
    const timer = this.flushTimers.get(internalId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.flushTimers.delete(internalId);
  }

  /** Stop every timer, because the plugin is unloading. */
  dispose(): void {
    for (const timer of this.flushTimers.values()) window.clearTimeout(timer);
    this.flushTimers.clear();
    this.cancelConsolidation();
    this.running.clear();
  }

  private armConsolidation(): void {
    this.cancelConsolidation();
    if (this.running.size > 0) return;
    this.consolidationTimer = window.setTimeout(() => {
      this.consolidationTimer = null;
      this.hooks.consolidate();
    }, this.consolidationIdleMs);
  }

  private cancelConsolidation(): void {
    if (this.consolidationTimer === null) return;
    window.clearTimeout(this.consolidationTimer);
    this.consolidationTimer = null;
  }
}

/**
 * Whether an agent's last consolidation is old enough that the plugin should
 * catch up at load rather than waiting for the idle window.
 *
 * "Older than a day" is read against the day, not the clock: a marker from
 * yesterday belongs to work the user may still be in the middle of, while one
 * from the day before is a gap a restart should close
 * (`designdocs/CUSTOM_AGENTS.md` §5, "Consolidation").
 *
 * @param consolidatedThrough - Marker from `MEMORY.md`, or null when never run.
 * @param today - Today's date as `YYYY-MM-DD`.
 */
export function isConsolidationStaleAtLoad(
  consolidatedThrough: string | null,
  today: string
): boolean {
  if (!consolidatedThrough) return true;
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const month = `${yesterday.getMonth() + 1}`.padStart(2, "0");
  const day = `${yesterday.getDate()}`.padStart(2, "0");
  return consolidatedThrough < `${yesterday.getFullYear()}-${month}-${day}`;
}
