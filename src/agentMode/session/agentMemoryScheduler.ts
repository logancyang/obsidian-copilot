export const AGENT_MEMORY_FLUSH_IDLE_MS = 2 * 60_000;

export const AGENT_MEMORY_CONSOLIDATION_IDLE_MS = 10 * 60_000;

export interface AgentMemorySchedulerHooks {
  flushChat(internalId: string): void;
  consolidate(): void;
}

export interface AgentMemorySchedulerOptions {
  flushIdleMs?: number;
  consolidationIdleMs?: number;
}

export class AgentMemoryScheduler {
  private readonly flushTimers = new Map<string, number>();
  private consolidationTimer: number | null = null;
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

  noteTurnStarted(internalId: string): void {
    this.running.add(internalId);
    this.cancelFlush(internalId);
    this.cancelConsolidation();
  }

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

  cancelFlush(internalId: string): void {
    const timer = this.flushTimers.get(internalId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.flushTimers.delete(internalId);
  }

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
