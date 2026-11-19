import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AnswerCompletion, type AnswerEnd } from "@/agentMode/session/answerCompletion";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import { buildChatFileChanges } from "@/agentMode/session/turnFileChanges";
import type {
  CopilotMode,
  PermissionDecision,
  PermissionPrompt,
  SessionAgent,
  SessionEvent,
  TurnFileChange,
} from "@/agentMode/session/types";
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
  files: readonly TurnFileChange[];
  denied: readonly string[];
  error?: Error;
}

interface HiddenRun {
  id: string;
  reply: string;
  sawTurn: boolean;
  denied: string[];
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

// A request the user can't answer from a chat they never see is turned down, and the agent says what it couldn't do.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export const HIDDEN_CHAT_DENY_MESSAGE =
  "Copilot turned this down: you're working in a chat another agent started, and the user can't approve changes from here. Don't try again. Say in your reply what you would have changed.";

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

  answerPermission(request: PermissionPrompt): Promise<PermissionDecision> | null {
    const hidden = Array.from(this.chats.values()).find(
      (chat) => chat.started?.getBackendSessionId() === request.sessionId
    );
    if (!hidden) return null;
    hidden.run?.denied.push(request.toolCall.title);
    const reject = request.options.find((option) => option.kind === "reject_once");
    return Promise.resolve(
      reject
        ? {
            outcome: { outcome: "selected", optionId: reject.optionId },
            denyMessage: HIDDEN_CHAT_DENY_MESSAGE,
          }
        : { outcome: { outcome: "cancelled" } }
    );
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
      denied: [],
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
      end = { reply: run.reply.trim(), files: [], denied: run.denied, error: asError(error) };
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
      const { userMessageId, turn } = session.sendPrompt(hiddenJobText(hidden, message));
      turn.then(
        () => {
          if (!run.sawTurn) run.finish({ error: new Error(`${hidden.agent.name} didn't start.`) });
        },
        (error: unknown) => run.finish({ error: asError(error) })
      );
      const { error } = await answer;
      if (!error) await untilSettled(session);
      const messages = session.store.getDisplayMessages();
      const asked = messages.findIndex((m) => m.id === userMessageId);
      return {
        reply: run.reply.trim(),
        files: buildChatFileChanges(messages.slice(asked + 1)),
        denied: run.denied,
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
        denied: end.denied,
        changed: end.files.map((change) => change.path),
        error: end.error?.message,
      }),
      end.files
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

// Claude reads a message mid-turn and Stop would move a waiting one into the user's draft, so a reply waits for the turn to end there; Codex and OpenCode hold it themselves.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
async function relay(
  parent: AgentSession,
  text: string,
  files: readonly TurnFileChange[]
): Promise<void> {
  for (;;) {
    const status = parent.getStatus();
    if (status === "closed") return;
    if (status === "starting" || (BUSY_STATUSES.has(status) && parent.acceptsMidTurnPrompts())) {
      await nextStatus(parent);
      continue;
    }
    let sent: ReturnType<AgentSession["sendPrompt"]>;
    try {
      sent = parent.sendPrompt(text);
    } catch (error) {
      logWarn("[Custom agents] couldn't pass an asked agent's reply to its chat", error);
      return;
    }
    const stopAttaching = attachFiles(parent, sent.userMessageId, files);
    const outcome = await sent.turn.catch(() => null);
    stopAttaching();
    // A reply dropped before it reached the agent, as by Stop while it waited, goes again once the chat can take it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
    if (outcome !== "cancelled" || parent.store.getMessage(sent.userMessageId)) return;
  }
}

// The relayed reply shows the files the asked agent changed in the existing Files changed card, so they ride on the message that carries the reply, which a busy chat adds only when it sends it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
function attachFiles(
  parent: AgentSession,
  messageId: string,
  files: readonly TurnFileChange[]
): () => void {
  const attach = () => files.length === 0 || parent.store.setFileChanges(messageId, [...files]);
  if (attach()) return () => {};
  const unsubscribe = parent.subscribe({
    onMessagesChanged: () => {},
    onStatusChanged: () => {},
    onPromptSent: () => {
      if (attach()) unsubscribe();
    },
  });
  return unsubscribe;
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

function nextStatus(session: AgentSession): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: () => {
        unsubscribe();
        resolve();
      },
    });
  });
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
