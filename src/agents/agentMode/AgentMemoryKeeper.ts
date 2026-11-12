import type { AgentFileManager } from "@/agents/AgentFileManager";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import {
  AGENT_MEMORY,
  holdMemoryNotice,
  markMemorizedThrough,
  MEMORIZED_THROUGH_TURN_KEY,
  releaseHeldMemoryNotice,
  showMemoryNotice,
} from "@/agents/agentMode/agentMemoryChat";
import {
  hasUnconsolidatedNotes,
  runAgentMemoryConsolidation,
  type AgentMemoryConsolidationOutcome,
} from "@/agents/agentMode/agentMemoryConsolidation";
import {
  buildFanoutMemoryTranscript,
  runAgentMemoryFlush,
  type AgentMemoryFlushOutcome,
  type AgentMemoryPassDeps,
} from "@/agents/agentMode/agentMemoryPass";
import {
  AgentMemoryScheduler,
  isConsolidationStaleAtLoad,
} from "@/agents/agentMode/agentMemoryScheduler";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ChatLifecycleListener } from "@/agentMode/session/chatLifecycle";
import type { FanoutTurnRequest } from "@/agentMode/session/fanout/FanoutOrchestrator";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { patchFrontmatter } from "@/utils/vaultAdapterUtils";
import type { App } from "obsidian";

export const MEMORY_PASS_SHUTDOWN_GRACE_MS = 10_000;

const FANOUT_FLUSH_HEADING = "Asked in passing";

export interface AgentMemoryHost {
  readonly subSessions: ReadOnlySubSessionRunner;
  getSession(id: string): AgentSession | null;
  getSessions(): AgentSession[];
  getSessionSourcePath(id: string): string;
}

export class AgentMemoryKeeper implements ChatLifecycleListener {
  private readonly passesInFlight = new Set<string>();
  private readonly scheduler = new AgentMemoryScheduler({
    flushChat: (id) => {
      const chat = this.host.getSession(id);
      if (chat) void this.beginFlush(chat);
    },
    consolidate: () => void this.consolidateIdleAgents(),
  });

  constructor(
    private readonly app: App,
    private readonly host: AgentMemoryHost,
    private readonly files: AgentFileManager
  ) {}

  private get deps(): AgentMemoryPassDeps {
    return { files: this.files, subSessions: this.host.subSessions };
  }

  onTurnStarted(chat: AgentSession): void {
    this.scheduler.noteTurnStarted(chat.internalId);
  }

  onTurnEnded(chat: AgentSession): void {
    this.scheduler.noteTurnEnded(chat.internalId);
    chat.updateChatState(AGENT_MEMORY, releaseHeldMemoryNotice);
  }

  onChatLeft(chat: AgentSession): void {
    void this.beginFlush(chat);
  }

  onFanoutTurn(turn: FanoutTurn, request: FanoutTurnRequest): void {
    for (const slug of request.agentSlugs) {
      const slot = turn.answers[slug];
      const answer = slot?.status === "done" ? slot.text.trim() : "";
      const key = `fanout:${slug}`;
      if (!answer || this.passesInFlight.has(key)) continue;
      this.passesInFlight.add(key);
      void runAgentMemoryFlush(this.deps, {
        agentSlug: slug,
        sessionBackendId: request.sessionBackendId,
        messages: buildFanoutMemoryTranscript(request.originalPromptText, answer),
        chatTitle: FANOUT_FLUSH_HEADING,
        signal: new AbortController().signal,
      }).finally(() => this.passesInFlight.delete(key));
    }
  }

  async beforeShutdown(): Promise<void> {
    this.scheduler.dispose();
    const passes = this.host
      .getSessions()
      .map((chat) => this.beginFlush(chat))
      .filter((pass): pass is Promise<void> => pass !== null);
    if (passes.length === 0) return;
    await Promise.race([
      Promise.allSettled(passes),
      new Promise((resolve) => window.setTimeout(resolve, MEMORY_PASS_SHUTDOWN_GRACE_MS)),
    ]);
  }

  updateNow(chatId: string): Promise<void> | null {
    const chat = this.host.getSession(chatId);
    return chat ? this.beginFlush(chat) : null;
  }

  consolidateNow(slug: string): Promise<AgentMemoryConsolidationOutcome> {
    return this.runConsolidation(slug);
  }

  async consolidateStaleAgentsOnLoad(): Promise<void> {
    const today = formatMemoryEntryDate(new Date());
    try {
      for (const { agent } of await this.files.listAgents()) {
        if (!agent.memoryEnabled) continue;
        if (!(await hasUnconsolidatedNotes(this.files, agent.slug))) continue;
        const stored = await this.files.readMemoryDocument(agent.slug);
        if (!isConsolidationStaleAtLoad(stored?.consolidatedThrough ?? null, today)) continue;
        await this.runConsolidation(agent.slug);
      }
    } catch (error) {
      logWarn("[Agents] Load-time consolidation sweep failed", error);
    }
  }

  private async consolidateIdleAgents(): Promise<void> {
    try {
      for (const { agent } of await this.files.listAgents()) {
        if (!agent.memoryEnabled) continue;
        if (!(await hasUnconsolidatedNotes(this.files, agent.slug))) continue;
        await this.runConsolidation(agent.slug);
      }
    } catch (error) {
      logWarn("[Agents] Idle consolidation sweep failed", error);
    }
  }

  private async runConsolidation(slug: string): Promise<AgentMemoryConsolidationOutcome> {
    const key = `consolidate:${slug}`;
    if (this.passesInFlight.has(key)) return { status: "skipped", reason: "no-new-notes" };
    this.passesInFlight.add(key);
    try {
      const outcome = await runAgentMemoryConsolidation(this.deps, {
        agentSlug: slug,
        sessionBackendId: getSettings().agentMode?.activeBackend ?? "opencode",
        signal: new AbortController().signal,
      });
      if (outcome.status === "written") {
        const notice = {
          kind: "consolidation" as const,
          agentName: outcome.agentName,
          path: outcome.memoryPath,
        };
        for (const chat of this.openChatsWith(slug)) {
          chat.updateChatState(AGENT_MEMORY, (state) => holdMemoryNotice(state, notice));
        }
      }
      return outcome;
    } finally {
      this.passesInFlight.delete(key);
    }
  }

  private openChatsWith(slug: string): AgentSession[] {
    return this.host
      .getSessions()
      .filter((chat) => chat.getStatus() !== "closed" && chat.getAgent().slug === slug);
  }

  private beginFlush(chat: AgentSession): Promise<void> | null {
    const agentSlug = chat.getAgent().slug;
    const chatId = chat.internalId;
    if (!agentSlug || this.passesInFlight.has(chatId)) return null;

    const messages = chat.getDisplayMessages();
    const newTurns = messages.slice(chat.readChatState(AGENT_MEMORY).memorizedThroughTurn);
    if (newTurns.length === 0) return null;

    const throughTurn = messages.length;
    const notePath = this.host.getSessionSourcePath(chatId);
    this.scheduler.cancelFlush(chatId);
    this.passesInFlight.add(chatId);
    return runAgentMemoryFlush(this.deps, {
      agentSlug,
      sessionBackendId: chat.backendId,
      messages: newTurns,
      chatTitle: chat.getLabel() ?? "",
      signal: new AbortController().signal,
    })
      .then((outcome) => {
        if (outcome.status === "failed") return;
        if (outcome.status === "skipped" && outcome.reason === "no-turns") return;
        this.recordFlush(chatId, throughTurn, notePath, outcome);
      })
      .finally(() => this.passesInFlight.delete(chatId));
  }

  private recordFlush(
    chatId: string,
    throughTurn: number,
    notePath: string,
    outcome: AgentMemoryFlushOutcome
  ): void {
    const chat = this.host.getSession(chatId);
    if (chat) {
      chat.updateChatState(AGENT_MEMORY, (state, view) => {
        const marked = markMemorizedThrough(state, throughTurn);
        if (outcome.status !== "written") return marked;
        const notice = {
          kind: "flush" as const,
          agentName: outcome.agentName,
          path: outcome.notePath,
        };
        return showMemoryNotice(marked, notice, view);
      });
      return;
    }
    if (!notePath) return;
    void patchFrontmatter(this.app, notePath, { [MEMORIZED_THROUGH_TURN_KEY]: throughTurn }).catch(
      (error: unknown) =>
        logWarn(`[Agents] Could not record ${MEMORIZED_THROUGH_TURN_KEY} on ${notePath}`, error)
    );
  }
}
