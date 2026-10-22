import type {
  BackendProcess,
  BackendState,
  CompactionSnapshot,
  PlanUsage,
  SessionUsage,
} from "@/agentMode/session/types";

export interface UsageTrackerDeps {
  backend: Pick<BackendProcess, "readContextWindow">;
  getModelId(): string | undefined;
  whenReady(): Promise<void>;
  notifyMessages(): void;
}

export class UsageTracker {
  private sessionUsage: SessionUsage | null = null;
  private planUsage: PlanUsage | null = null;

  constructor(private readonly deps: UsageTrackerDeps) {}

  getSessionUsage(): SessionUsage | null {
    return this.sessionUsage;
  }

  getPlanUsage(): PlanUsage | null {
    return this.planUsage;
  }

  applyPlanUsage(planUsage: PlanUsage | null): void {
    this.planUsage = planUsage;
    this.deps.notifyMessages();
  }

  async seedSessionUsage(usage: SessionUsage | undefined): Promise<void> {
    if (!usage) return;
    this.sessionUsage = usage;
    this.deps.notifyMessages();
    // A persisted snapshot can predate the model's window being known — hosted models
    // never carry one on the wire, and older chats were saved before windows were
    // filled in at all — so without this a reopened chat shows a bare count until its
    // next turn (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    if (usage.contextWindow === undefined) await this.fillSeededContextWindow(usage);
  }

  private async fillSeededContextWindow(seeded: SessionUsage): Promise<void> {
    if (!this.deps.backend.readContextWindow) return;
    // A chat with no resumable backend session is seeded into a freshly created one,
    // BEFORE its `newSession` has resolved — so at call time the model is not known
    // yet. Wait for startup to settle rather than silently skipping, or exactly those
    // older chats would stay count-only until their next turn
    // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    try {
      await this.deps.whenReady();
    } catch {
      return;
    }
    const wireModelId = this.deps.getModelId() ?? null;
    if (!wireModelId) return;
    let contextWindow: number | null = null;
    try {
      contextWindow = await this.deps.backend.readContextWindow(wireModelId);
    } catch {
      return;
    }
    if (!contextWindow) return;
    if (this.sessionUsage !== seeded) return;
    if (this.deps.getModelId() !== wireModelId) return;
    this.sessionUsage = { ...seeded, contextWindow };
    this.deps.notifyMessages();
  }

  applyUsageUpdate(usage: SessionUsage): void {
    // Some backends use zero as an empty terminal snapshot after cancellation.
    // It does not measure consumed context, so wait for a positive reading.
    // https://github.com/logancyang/obsidian-copilot/issues/2975
    if (!usage.usedTokens) return;
    if (usage.contextWindow === undefined && this.sessionUsage?.contextWindow !== undefined) {
      return;
    }
    this.sessionUsage = usage;
    this.deps.notifyMessages();
  }

  // Compaction reports the new context size directly, so it bypasses applyUsageUpdate's guards.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/635
  applyCompactedUsage(compaction: CompactionSnapshot): boolean {
    if (compaction.status !== "completed" || compaction.postTokens === undefined) return false;
    this.sessionUsage = {
      usedTokens: compaction.postTokens,
      contextWindow: this.sessionUsage?.contextWindow,
      updatedAt: Date.now(),
    };
    return true;
  }

  /**
   * Drop the held context window when the model changes, keeping the count. `applyUsageUpdate`
   * ignores windowless snapshots while a windowed one is held, so a stale window would stick.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/193
   */
  dropUsageWindowOnModelChange(next: BackendState | null): void {
    const before = this.deps.getModelId();
    const after = next?.model?.current.baseModelId;
    if (!before || !after || before === after) return;
    if (this.sessionUsage?.contextWindow === undefined) return;
    this.sessionUsage = { ...this.sessionUsage, contextWindow: undefined };
    this.deps.notifyMessages();
  }
}
