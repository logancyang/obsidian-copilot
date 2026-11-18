import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AnswerCompletion, type AnswerEnd } from "@/agentMode/session/answerCompletion";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import { buildChatFileChanges } from "@/agentMode/session/turnFileChanges";
import { PERMISSION_REJECT_KINDS } from "@/agentMode/session/types";
import type {
  BackendId,
  CopilotMode,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  SessionAgent,
  SessionEvent,
  TurnFileChange,
} from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { formatAgentReply } from "@/agents/agentReply";
import { loadAgentSessionPrompt } from "@/agents/agentSessionPrompt";
import { readTurnMemorySaves, type MemorySave } from "@/agents/memorySaves";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate, subscribeToCustomAgentsGate } from "@/agents/customAgentsGate";
import { USER_SENDER } from "@/constants";
import { logWarn } from "@/logger";
import { v4 as uuidv4 } from "uuid";

export interface HiddenChatStart {
  agent: CustomAgent;
  prompt: SessionAgent;
  projectId: ProjectScopeId;
  mode: CopilotMode | null;
  observeSessionEvent: (event: SessionEvent) => void;
  askedFrom: BackendId;
  resume: AgentMention["chat"];
}

export interface HiddenAgentChatsHost {
  store: () => CustomAgentStore | undefined;
  vaultBase: () => string | null;
  listedChat: (chat: ChatStateHost) => AgentSession | null;
  unavailableReason: (agent: CustomAgent) => string | null;
  startChat: (start: HiddenChatStart) => Promise<AgentSession>;
}

export type AgentRefusal =
  | { kind: "unavailable" }
  | { kind: "not_from_here" }
  | { kind: "unknown_agent"; roster: readonly CustomAgent[] }
  | { kind: "self"; agent: CustomAgent };

export type AskAgentResult =
  | { kind: "asked"; agent: CustomAgent }
  | { kind: "sent"; agent: CustomAgent; now: boolean }
  | { kind: "awaiting_answer"; agent: CustomAgent; question: string }
  | { kind: "cannot_run"; agent: CustomAgent; reason: string }
  | AgentRefusal;

export type CheckAgentResult =
  | { kind: "progress"; agent: CustomAgent; progress: string }
  | { kind: "not_asked"; agent: CustomAgent }
  | AgentRefusal;

export type AnswerAgentResult =
  | { kind: "answered" | "no_question"; agent: CustomAgent }
  | AgentRefusal;

export type StopAgentResult =
  | { kind: "stopped" | "not_working" | "not_asked"; agent: CustomAgent }
  | AgentRefusal;

type StopReason = "stopped_by_user" | "stopped_from_list" | "agent_deleted";

interface AskingChat {
  parent: AgentSession;
  agent: CustomAgent;
  agents: readonly CustomAgent[];
  store: CustomAgentStore;
}

interface HiddenRunEnd {
  reply: string;
  files: readonly TurnFileChange[];
  error?: Error;
}

interface HiddenRun {
  id: string;
  message: string;
  askedIn: string | null;
  startedAt: number;
  since: string | null;
  reply: string;
  sawTurn: boolean;
  waiting: number;
  declined: boolean;
  stopped: StopReason | null;
  question: string | null;
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
  continuedAt: Map<string, number>;
}

export interface AskedAgentChat {
  session: AgentSession;
  continuedAt: ReadonlyMap<string, number>;
}

const PROGRESS_TEXT_CHARS = 1500;
const PROGRESS_STEPS = 10;
const PROGRESS_STEP_CHARS = 120;

const BUSY_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "starting",
  "running",
  "awaiting_permission",
]);

export const HIDDEN_CHAT_DENY_MESSAGE =
  "Copilot turned this down: you're working in a chat another agent started, and the user can't approve changes from here. Don't try again. Say in your reply what you would have changed.";

export class HiddenAgentChats {
  private readonly chats = new Map<string, HiddenChat>();
  private readonly watchedParents = new Map<string, () => void>();
  private readonly unsubscribeGate: () => void;

  constructor(private readonly host: HiddenAgentChatsHost) {
    // The license is checked only when an @ is sent, so an agent asked before it lapsed finishes and its reply arrives; only hiding custom agents altogether stops it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
    this.unsubscribeGate = subscribeToCustomAgentsGate(() => {
      if (getCustomAgentsGate() === "hidden") this.stopAll();
    });
  }

  ask(chat: ChatStateHost | null, agentName: string, message: string): AskAgentResult {
    const asking = this.resolve(chat, agentName);
    if ("kind" in asking) return asking;
    const { parent, agent, agents, store } = asking;
    const key = chatKey(parent, agent.slug);
    const existing = this.chats.get(key);
    if (existing?.run) {
      // An agent waiting on the user's answer gets only that answer: a small model relays the question and also asks the agent it again, which would answer it for the user.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
      const { question } = existing.run;
      if (question !== null) return { kind: "awaiting_answer", agent, question };
      this.sendMore(
        existing,
        `${existing.from} sent you more from the user while you work.\n\n<message from="${existing.from}">\n${message}\n</message>`
      );
      return {
        kind: "sent",
        agent,
        now: existing.started?.acceptsMidTurnPrompts() ?? false,
      };
    }
    // An agent whose model can't run on this device is turned down with the reason, so no other model answers as it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
    const reason = this.host.unavailableReason(agent);
    if (reason) return { kind: "cannot_run", agent, reason };
    const from = agents.find((other) => other.slug === parent.agentSlug)?.name ?? "Copilot";
    const hidden =
      existing?.started && existing.started.getStatus() !== "closed"
        ? existing
        : this.open(parent, agent, from, store);
    this.chats.set(key, hidden);
    void this.run(hidden, message);
    return { kind: "asked", agent };
  }

  // The user asks the current agent how an asked agent is doing; it reads the progress without interrupting it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  check(chat: ChatStateHost | null, agentName: string): CheckAgentResult {
    const asking = this.resolve(chat, agentName);
    if ("kind" in asking) return asking;
    const hidden = this.chats.get(chatKey(asking.parent, asking.agent.slug));
    if (!hidden) return { kind: "not_asked", agent: asking.agent };
    return { kind: "progress", agent: asking.agent, progress: describeProgress(hidden) };
  }

  // The asked agent asks the user through the agent that asked it, since the user never sees its chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  askUser(chat: ChatStateHost | null, question: string): "asked" | "unavailable" | "not_from_here" {
    if (getCustomAgentsGate() !== "full") return "unavailable";
    const run = Array.from(this.chats.values()).find(
      (hidden) => chat !== null && hidden.started === chat
    )?.run;
    if (!run) return "not_from_here";
    run.question = question;
    return "asked";
  }

  answer(chat: ChatStateHost | null, agentName: string, answer: string): AnswerAgentResult {
    const asking = this.resolve(chat, agentName);
    if ("kind" in asking) return asking;
    const hidden = this.chats.get(chatKey(asking.parent, asking.agent.slug));
    if (hidden?.run?.question == null) return { kind: "no_question", agent: asking.agent };
    this.sendMore(
      hidden,
      `${hidden.from} passed on the user's answer to your question.\n\n<answer from="user">\n${answer}\n</answer>`
    );
    return { kind: "answered", agent: asking.agent };
  }

  // The user stops an agent from the chat that asked it, by telling its agent or from the running agents list; its changes stay and its chat stays open to continue.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  stop(
    chat: ChatStateHost | null,
    agentName: string,
    { fromList = false }: { fromList?: boolean } = {}
  ): StopAgentResult {
    const asking = this.resolve(chat, agentName);
    if ("kind" in asking) return asking;
    const hidden = this.chats.get(chatKey(asking.parent, asking.agent.slug));
    const kind = !hidden
      ? "not_asked"
      : this.stopRun(hidden, fromList ? "stopped_from_list" : "stopped_by_user")
        ? "stopped"
        : "not_working";
    return { kind, agent: asking.agent };
  }

  // An agent deleted while it works stops at once, and the chats it was asked into go with it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  stopAgent(slug: string): void {
    for (const [key, hidden] of Array.from(this.chats)) {
      if (hidden.agent.slug !== slug || this.stopRun(hidden, "agent_deleted")) continue;
      this.chats.delete(key);
      void hidden.session.then(stopSession, () => undefined);
    }
  }

  workingIn(slug: string): string | null {
    return (
      Array.from(this.chats.values()).find((hidden) => hidden.agent.slug === slug && hidden.run)
        ?.from ?? null
    );
  }

  // The chat's running agents list draws only runs still held here for that chat, with what each was asked; a saved run can outlive its chat, and a chat continued from another copies its runs.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/948
  workingOn(parent: AgentSession, runId: string): string | null {
    return (
      Array.from(this.chats.values()).find(
        (hidden) => hidden.parent === parent && hidden.run?.id === runId
      )?.run?.message ?? null
    );
  }

  // The user watches an asked agent's chat from the run that asked it; a run whose chat is gone, as after a restart, or never opened has nothing to show.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/948
  askedChat(parent: AgentSession, run: AgentMention): AskedAgentChat | null {
    const hidden = this.chats.get(chatKey(parent, run.agent));
    const session = hidden?.started;
    if (!hidden || !session || session.getBackendSessionId() !== run.chat?.sessionId) return null;
    return { session, continuedAt: hidden.continuedAt };
  }

  // The user never sees an asked agent's chat, so its request shows as a card in the chat that asked, from that agent, and the answer goes straight back.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/946
  answerPermission(request: PermissionPrompt): Promise<PermissionDecision> | null {
    const hidden = Array.from(this.chats.values()).find(
      (chat) => chat.started?.getBackendSessionId() === request.sessionId
    );
    if (!hidden) return null;
    const { parent, started, run } = hidden;
    // An asked agent changes nothing while the chat that asked is in Plan mode, and a request after its run ended has no card to answer it, so both are turned down and the agent says what it couldn't do.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/946
    if (!run || [parent, started].some((chat) => chat?.getState()?.mode?.current === "plan")) {
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
    run.waiting++;
    record(parent, run, { status: "permission" });
    return parent
      .handleToolPermission({ ...request, requester: requesterOf(hidden) })
      .then((decision) => {
        run.waiting--;
        if (hidden.run !== run || run.stopped) return decision;
        // Codex and OpenCode end the turn on a turned-down request without a word, so the relay says the user turned it down.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/946
        if (decision.outcome.outcome === "selected") {
          const { optionId } = decision.outcome;
          const kind = request.options.find((option) => option.optionId === optionId)?.kind;
          if (kind && PERMISSION_REJECT_KINDS.includes(kind)) run.declined = true;
        }
        if (run.waiting === 0) record(parent, run, { status: "working" });
        return decision;
      });
  }

  dispose(): void {
    this.unsubscribeGate();
    this.stopAll();
  }

  private resolve(chat: ChatStateHost | null, agentName: string): AskingChat | AgentRefusal {
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
    return { parent, agent, agents, store };
  }

  // A new instruction for an agent still at work redirects it in the same chat instead of starting over, and the user's answer reaches an agent waiting on a question the same way; its reply then starts after the answer.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
  private sendMore(hidden: HiddenChat, text: string): void {
    const run = hidden.run;
    if (run?.question != null) {
      run.question = null;
      run.reply = "";
      record(hidden.parent, run, { status: "working" });
    }
    void hidden.session.then(
      (session) => {
        // A message sent on while the agent's chat starts must not reach an agent stopped meanwhile, which would work on with no run to show or stop it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
        if (run?.stopped) return;
        // A refused message, as when the agent's usage limit is reached, ends its turn before it starts, so nothing else would end the run waiting on it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
        void session
          .sendPrompt(text)
          .turn.catch((error: unknown) => run?.finish({ error: asError(error) }));
      },
      () => undefined
    );
  }

  private stopRun(hidden: HiddenChat, reason: StopReason): boolean {
    const run = hidden.run;
    if (!run) return false;
    run.stopped = reason;
    hidden.parent.rejectToolRequestsFrom(requesterOf(hidden));
    run.finish({ error: undefined });
    void hidden.started
      ?.cancel()
      .catch((error) => logWarn("[Custom agents] stopping an asked agent's turn failed", error));
    return true;
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
      continuedAt: new Map(),
      session: this.startSession(parent, agent, store, (event) => {
        const run = hidden.run;
        // A chat carried on from before replays its history as it opens, which is not this run's work.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
        if (!run || !hidden.started) return;
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
      ? await loadAgentSessionPrompt(store, agent.slug, vaultBase, { asked: true })
      : null;
    if (!prompt) throw new Error(`${agent.name} couldn't be loaded.`);
    return this.host.startChat({
      agent,
      prompt,
      projectId: parent.projectId,
      mode: parent.getState()?.mode?.current ?? null,
      observeSessionEvent,
      askedFrom: parent.backendId,
      resume: savedChat(parent, agent.slug),
    });
  }

  private async run(hidden: HiddenChat, message: string): Promise<void> {
    const run: HiddenRun = {
      id: uuidv4(),
      message,
      askedIn: lastUserMessageId(hidden.parent),
      startedAt: Date.now(),
      since: null,
      reply: "",
      sawTurn: false,
      waiting: 0,
      declined: false,
      stopped: null,
      question: null,
      completion: new AnswerCompletion((text) => (run.reply += text)),
      finish: () => {},
    };
    const answer = untilFinished(run);
    hidden.run = run;
    record(hidden.parent, run, {
      id: run.id,
      agent: hidden.agent.slug,
      name: hidden.agent.name,
      status: "working",
      startedAt: run.startedAt,
    });
    let end: HiddenRunEnd;
    try {
      const session = await hidden.session;
      const sessionId = session.getBackendSessionId();
      if (sessionId)
        record(hidden.parent, run, { chat: { backendId: session.backendId, sessionId } });
      end = await this.runTurn(hidden, run, answer, session, message);
    } catch (error) {
      end = { reply: run.reply.trim(), files: [], error: asError(error) };
    } finally {
      hidden.run = null;
      // A card never outlives the run that raised it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/946
      hidden.parent.rejectToolRequestsFrom(requesterOf(hidden));
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
      if (run.stopped) return { reply: "", files: [] };
      const { userMessageId, turn } = session.sendPrompt(hiddenJobText(hidden, message));
      run.since = userMessageId;
      hidden.continuedAt.set(userMessageId, run.startedAt);
      turn.then(
        () => {
          if (!run.sawTurn) run.finish({ error: new Error(`${hidden.agent.name} didn't start.`) });
        },
        (error: unknown) => run.finish({ error: asError(error) })
      );
      let ended = answer;
      let error: Error | undefined;
      for (;;) {
        ({ error } = await ended);
        if (!error) await untilSettled(session);
        if (run.stopped) await untilReplyClosed(session);
        const dropped = this.chats.get(chatKey(hidden.parent, hidden.agent.slug)) !== hidden;
        if (error || run.stopped || run.question === null || dropped) break;
        // The asked agent's question goes to the user through the asking agent, and the run waits for the answer as the next turn.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
        ended = untilFinished(run);
        record(hidden.parent, run, { status: "question" });
        void relay(
          hidden.parent,
          formatAgentReply({
            agent: hidden.agent.slug,
            name: hidden.agent.name,
            mention: run.id,
            reply: run.question,
            changed: [],
            question: true,
          }),
          []
        );
      }
      const messages = session.store.getDisplayMessages();
      const asked = messages.findIndex((m) => m.id === userMessageId);
      return {
        reply: run.reply.trim(),
        files: buildChatFileChanges(messages.slice(asked + 1)),
        ...(error ? { error } : {}),
      };
    } finally {
      unsubscribe();
    }
  }

  private finishRun(hidden: HiddenChat, run: HiddenRun, end: HiddenRunEnd): void {
    // A stopped chat leaves the map, so a run that ends after its stop, as when its start fails on unload, records and relays nothing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
    const key = chatKey(hidden.parent, hidden.agent.slug);
    if (this.chats.get(key) !== hidden) return;
    if (getCustomAgentsGate() === "hidden") return;
    record(hidden.parent, run, {
      status: run.stopped ? "stopped" : end.error ? "didnt_finish" : "finished",
    });
    // The asking chat shows the asked agent's save as its own chat does, as a line in place of its MEMORY.md among the changed files, so the asking agent hears only the files the user sees.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/969
    const memorySaves = readTurnMemorySaves(end.files, {
      agentName: hidden.agent.name,
      memoryPath: hidden.agent.memoryPath,
    });
    const shown = memorySaves.length
      ? end.files.filter((change) => change.path !== hidden.agent.memoryPath)
      : end.files;
    void relay(
      hidden.parent,
      formatAgentReply({
        agent: hidden.agent.slug,
        name: hidden.agent.name,
        mention: run.id,
        reply: end.reply,
        changed: shown.map((change) => change.path),
        error: end.error?.message,
        stopped: run.stopped ?? undefined,
        declined: run.declined,
        stillWorking: Array.from(this.chats.values())
          .filter(
            (other) =>
              other.parent === hidden.parent && other.run?.question === null && !other.run.stopped
          )
          .map((other) => other.agent.name),
      }),
      end.files,
      memorySaves
    );
    if (run.stopped !== "agent_deleted") return;
    this.chats.delete(key);
    void hidden.session.then(stopSession, () => undefined);
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
  files: readonly TurnFileChange[],
  memorySaves: readonly MemorySave[] = []
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
    const stopAttaching = attachFiles(parent, sent.userMessageId, files, memorySaves);
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
  files: readonly TurnFileChange[],
  memorySaves: readonly MemorySave[]
): () => void {
  const attach = () =>
    files.length === 0 || parent.store.setFileChanges(messageId, [...files], memorySaves);
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

function requesterOf({ agent }: HiddenChat): PermissionRequester {
  return { agent: { slug: agent.slug, name: agent.name, faceSrc: agent.faceSrc } };
}

function savedChat(parent: AgentSession, slug: string): AgentMention["chat"] {
  const runs = parent.store.getDisplayMessages().flatMap((message) => message.agentMentions ?? []);
  return runs.filter((run) => run.agent === slug && run.chat).at(-1)?.chat;
}

function lastUserMessageId(parent: AgentSession): string | null {
  const messages = parent.store.getDisplayMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === USER_SENDER) return messages[i].id;
  }
  return null;
}

// Each @ keeps its agent's run on the message that asked, the state later steps draw, resume and stop from.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
function record(parent: AgentSession, run: HiddenRun, change: Partial<AgentMention>): void {
  if (!run.askedIn) return;
  const mentions = parent.store.getMessage(run.askedIn)?.agentMentions ?? [];
  const known = mentions.some((mention) => mention.id === run.id);
  parent.setAgentMentions(
    run.askedIn,
    known
      ? mentions.map((mention) => (mention.id === run.id ? { ...mention, ...change } : mention))
      : [...mentions, change as AgentMention]
  );
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

function untilFinished(run: HiddenRun): Promise<AnswerEnd> {
  return new Promise((resolve) => {
    let finished = false;
    run.finish = (end) => {
      if (finished) return;
      finished = true;
      resolve(end);
    };
  });
}

function describeProgress({ agent: { name }, run, started }: HiddenChat): string {
  if (!run) return `${name} isn't working on anything from this chat now.`;
  const minutes = Math.floor((Date.now() - run.startedAt) / 60_000);
  const messages = started?.store.getDisplayMessages() ?? [];
  const steps = messages
    .slice(messages.findIndex((message) => message.id === run.since) + 1)
    .flatMap((message) => message.parts ?? [])
    .flatMap((part) =>
      part.kind === "tool_call"
        ? [`- ${part.title.slice(0, PROGRESS_STEP_CHARS)} (${part.status})`]
        : []
    )
    .slice(-PROGRESS_STEPS);
  const written = run.reply.trim().slice(-PROGRESS_TEXT_CHARS);
  return [
    run.question !== null
      ? `${name} is waiting for the user to answer this question:\n${run.question}`
      : run.waiting > 0
        ? `${name} is waiting for the user's OK on a permission card in this chat.`
        : `${name} has been working for ${minutes < 1 ? "under a minute" : `${minutes} min`}.`,
    written
      ? `The end of what ${name} has written so far:\n${written}`
      : `${name} hasn't written anything yet.`,
    ...(steps.length > 0 ? [`${name}'s latest steps:\n${steps.join("\n")}`] : []),
  ].join("\n\n");
}

const ASKED_MESSAGE = /<(message|answer) from="[^"]*">\n([\s\S]*)\n<\/\1>$/;

// The asked agent's chat shows what the asking agent sent in its own words, without the framing that tells the agent where it came from.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function readAskedMessage(text: string): { answer: boolean; text: string } | null {
  const match = ASKED_MESSAGE.exec(text.trimEnd());
  return match ? { answer: match[1] === "answer", text: match[2] } : null;
}

function hiddenJobText({ from }: HiddenChat, message: string): string {
  return [
    `${from} asked you this for the user, from another chat. Your reply goes back to ${from}, who passes it on to the user.`,
    `If you can't go on without the user's answer to a question, ask it with the ask_user tool from obsidian-copilot, then end your turn; the answer comes back as your next message.`,
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

// A stopped turn records the files it changed after its chat goes idle, and the stop relay carries them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
function untilReplyClosed(session: AgentSession): Promise<void> {
  const closed = () => {
    const last = session.store.getDisplayMessages().at(-1);
    return (
      session.getStatus() === "closed" ||
      !last ||
      last.sender === USER_SENDER ||
      last.turnStopReason !== undefined
    );
  };
  if (closed()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!closed()) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = session.subscribe({ onMessagesChanged: check, onStatusChanged: check });
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
