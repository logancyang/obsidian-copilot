import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AnswerCompletion, type AnswerEnd } from "@/agentMode/session/answerCompletion";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import type { CopilotMode, SessionAgent, SessionEvent } from "@/agentMode/session/types";
import { formatAgentReply } from "@/agents/agentReply";
import { loadAgentSessionPrompt } from "@/agents/agentSessionPrompt";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate, subscribeToCustomAgentsGate } from "@/agents/customAgentsGate";
import { logWarn } from "@/logger";
import { v4 as uuidv4 } from "uuid";

export interface HiddenChatStart {
  agent: CustomAgent;
  prompt: SessionAgent;
  projectId: ProjectScopeId;
  mode: CopilotMode | null;
  observeSessionEvent: (event: SessionEvent) => void;
}

export interface HiddenAgentChatsHost {
  store: () => CustomAgentStore | undefined;
  vaultBase: () => string | null;
  listedChat: (chat: ChatStateHost) => AgentSession | null;
  startChat: (start: HiddenChatStart) => Promise<AgentSession>;
}

export type AskAgentResult =
  | { kind: "asked"; agent: CustomAgent }
  | { kind: "unavailable" }
  | { kind: "not_from_here" }
  | { kind: "unknown_agent"; roster: readonly CustomAgent[] }
  | { kind: "self"; agent: CustomAgent }
  | { kind: "busy"; agent: CustomAgent };

interface HiddenRunEnd {
  reply: string;
  error?: Error;
}

interface HiddenRun {
  id: string;
  reply: string;
  sawTurn: boolean;
  completion: AnswerCompletion;
  finish: (end: AnswerEnd) => void;
}

interface HiddenChat {
  parent: AgentSession;
  agent: CustomAgent;
  from: string;
  session: Promise<AgentSession>;
  started: AgentSession | null;
  run: HiddenRun | null;
}

const BUSY_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "starting",
  "running",
  "awaiting_permission",
]);

export class HiddenAgentChats {
  private readonly chats = new Map<string, HiddenChat>();
  private readonly watchedParents = new Map<string, () => void>();
  private readonly unsubscribeGate: () => void;

  constructor(private readonly host: HiddenAgentChatsHost) {
    // Custom agents stop with the license, so an agent asked before it lapsed stops too.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
    this.unsubscribeGate = subscribeToCustomAgentsGate(() => {
      if (getCustomAgentsGate() !== "full") this.stopAll();
    });
  }

  ask(chat: ChatStateHost | null, agentName: string, message: string): AskAgentResult {
    const store = this.host.store();
    if (getCustomAgentsGate() !== "full" || !store) return { kind: "unavailable" };
    const parent = chat ? this.host.listedChat(chat) : null;
    if (!parent) return { kind: "not_from_here" };
    const agents = store.getAgents();
    const agent = findAgent(agents, agentName);
    if (!agent) {
      return {
        kind: "unknown_agent",
        roster: agents.filter((other) => other.slug !== parent.agentSlug),
      };
    }
    if (agent.slug === parent.agentSlug) return { kind: "self", agent };
    const key = chatKey(parent, agent.slug);
    const existing = this.chats.get(key);
    if (existing?.run) return { kind: "busy", agent };
    const from = agents.find((other) => other.slug === parent.agentSlug)?.name ?? "Copilot";
    const hidden =
      existing?.started && existing.started.getStatus() !== "closed"
        ? existing
        : this.open(parent, agent, from, store);
    this.chats.set(key, hidden);
    void this.run(hidden, message);
    return { kind: "asked", agent };
  }

  dispose(): void {
    this.unsubscribeGate();
    this.stopAll();
  }

  private open(
    parent: AgentSession,
    agent: CustomAgent,
    from: string,
    store: CustomAgentStore
  ): HiddenChat {
    this.watchParent(parent);
    const hidden: HiddenChat = {
      parent,
      agent,
      from,
      started: null,
      run: null,
      session: this.startSession(parent, agent, store, (event) => {
        const run = hidden.run;
        if (!run) return;
        if (event.update.sessionUpdate === "turn_started") run.sawTurn = true;
        const end = run.completion.handle(event);
        if (end) run.finish(end);
      }).then((session) => (hidden.started = session)),
    };
    return hidden;
  }

  private async startSession(
    parent: AgentSession,
    agent: CustomAgent,
    store: CustomAgentStore,
    observeSessionEvent: (event: SessionEvent) => void
  ): Promise<AgentSession> {
    const vaultBase = this.host.vaultBase();
    const prompt = vaultBase
      ? await loadAgentSessionPrompt(store, agent.slug, vaultBase, { saveRules: false })
      : null;
    if (!prompt) throw new Error(`${agent.name} couldn't be loaded.`);
    return this.host.startChat({
      agent,
      prompt,
      projectId: parent.projectId,
      mode: parent.getState()?.mode?.current ?? null,
      observeSessionEvent,
    });
  }

  private async run(hidden: HiddenChat, message: string): Promise<void> {
    const run: HiddenRun = {
      id: uuidv4(),
      reply: "",
      sawTurn: false,
      completion: new AnswerCompletion((text) => (run.reply += text)),
      finish: () => {},
    };
    const answer = new Promise<AnswerEnd>((resolve) => {
      let finished = false;
      run.finish = (end) => {
        if (finished) return;
        finished = true;
        resolve(end);
      };
    });
    hidden.run = run;
    let end: HiddenRunEnd;
    try {
      end = await this.runTurn(hidden, run, answer, await hidden.session, message);
    } catch (error) {
      end = { reply: run.reply.trim(), error: asError(error) };
    } finally {
      hidden.run = null;
    }
    this.finishRun(hidden, run, end);
  }

  private async runTurn(
    hidden: HiddenChat,
    run: HiddenRun,
    answer: Promise<AnswerEnd>,
    session: AgentSession,
    message: string
  ): Promise<HiddenRunEnd> {
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => {
        if (status === "closed") {
          run.finish({
            error: new Error(`${hidden.agent.name}'s chat stopped before it finished.`),
          });
        }
      },
    });
    try {
      // A continued chat follows the mode the asking chat is in now, not the one it started in.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
      await replayPersistedMode(session, hidden.parent.getState()?.mode?.current ?? null);
      const { turn } = session.sendPrompt(hiddenJobText(hidden, message));
      turn.then(
        () => {
          if (!run.sawTurn) run.finish({ error: new Error(`${hidden.agent.name} didn't start.`) });
        },
        (error: unknown) => run.finish({ error: asError(error) })
      );
      const { error } = await answer;
      if (!error) await untilSettled(session);
      return {
        reply: run.reply.trim(),
        ...(error ? { error } : {}),
      };
    } finally {
      unsubscribe();
    }
  }

  private finishRun(hidden: HiddenChat, run: HiddenRun, end: HiddenRunEnd): void {
    // A stopped chat leaves the map, so a run that ends after its stop, as when its start fails on unload, relays nothing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
    if (this.chats.get(chatKey(hidden.parent, hidden.agent.slug)) !== hidden) return;
    if (getCustomAgentsGate() !== "full") return;
    void relay(
      hidden.parent,
      formatAgentReply({
        agent: hidden.agent.slug,
        name: hidden.agent.name,
        mention: run.id,
        reply: end.reply,
        error: end.error?.message,
      })
    );
  }

  private watchParent(parent: AgentSession): void {
    if (this.watchedParents.has(parent.internalId)) return;
    const unsubscribe = parent.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => {
        if (status === "closed") this.stopChatsOf(parent);
      },
    });
    this.watchedParents.set(parent.internalId, unsubscribe);
  }

  private stopAll(): void {
    for (const hidden of Array.from(this.chats.values())) this.stopChatsOf(hidden.parent);
  }

  private stopChatsOf(parent: AgentSession): void {
    this.watchedParents.get(parent.internalId)?.();
    this.watchedParents.delete(parent.internalId);
    for (const [key, hidden] of Array.from(this.chats)) {
      if (hidden.parent !== parent) continue;
      this.chats.delete(key);
      hidden.run?.finish({ error: undefined });
      void hidden.session.then(stopSession, () => undefined);
    }
  }
}

async function relay(parent: AgentSession, text: string): Promise<void> {
  if (parent.getStatus() === "closed") return;
  try {
    await parent.sendPrompt(text).turn;
  } catch (error) {
    logWarn("[Custom agents] couldn't pass an asked agent's reply to its chat", error);
  }
}

async function stopSession(session: AgentSession): Promise<void> {
  try {
    await session.cancel();
    if (session.getBackendSessionId()) await session.releaseBackendSession();
  } catch (error) {
    logWarn("[Custom agents] stopping an asked agent's chat failed", error);
  } finally {
    await session.dispose();
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function chatKey(parent: AgentSession, slug: string): string {
  return `${parent.internalId}\n${slug}`;
}

function findAgent(agents: readonly CustomAgent[], name: string): CustomAgent | undefined {
  const wanted = name.trim().replace(/^@/, "").toLowerCase();
  // The tool lists agents by name, and a renamed agent keeps its folder, so another agent's folder can carry the asked name.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  return (
    agents.find((agent) => agent.name.toLowerCase() === wanted) ??
    agents.find((agent) => agent.slug === wanted)
  );
}

function hiddenJobText({ from }: HiddenChat, message: string): string {
  return [
    `${from} asked you this for the user, from another chat. Your reply goes back to ${from}, who passes it on to the user. You can't save rules to your memory or change your instruction from this chat.`,
    `<message from="${from}">\n${message}\n</message>`,
  ].join("\n\n");
}

function untilSettled(session: AgentSession): Promise<void> {
  if (!BUSY_STATUSES.has(session.getStatus())) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => {
        if (BUSY_STATUSES.has(status)) return;
        unsubscribe();
        resolve();
      },
    });
  });
}
