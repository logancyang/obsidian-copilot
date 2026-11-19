import { AgentSession, type AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { writePermissionRequest } from "@/agentMode/session/testing/permissionPrompts";
import type { BackendDescriptor, BackendState, PermissionPrompt } from "@/agentMode/session/types";
import {
  HIDDEN_CHAT_DENY_MESSAGE,
  HiddenAgentChats,
  type HiddenChatStart,
} from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import * as customAgentsGate from "@/agents/customAgentsGate";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const AUTO_MODE: BackendState = { model: null, mode: { current: "auto", options: [], apply: {} } };
const PLAN_CHANGE = Object.freeze({
  path: "Plans/Launch plan.md",
  status: "modified" as const,
  before: "# Launch plan\n",
  after: "# Launch plan\nRisk: the intro is too long.\n",
  additions: 1,
  deletions: 0,
});
const CLAUDE_LIKE = { midTurnDelivery: true, withdraw: true } as unknown as BackendDescriptor;

let vault: FakeAgentVault;
let store: CustomAgentStore;
let fake: FakeAgentBackend;
let chats: HiddenAgentChats;
let listed: AgentSession[];
let started: AgentSession[];
let starts: HiddenChatStart[];
let startWaiters: Set<() => void>;
let startChat: jest.Mock<Promise<AgentSession>, [HiddenChatStart]>;
let nextChat = 1;

function seedAgent(slug: string, name: string, instruction: string): void {
  vault.writeByHand(
    `copilot/agents/${slug}/instructions.md`,
    serializeInstructionsFile({ name, title: `${name}'s title`, model: null }, instruction)
  );
}

async function openChat(
  options: {
    agentSlug?: string;
    projectId?: string;
    listed?: boolean;
    descriptor?: BackendDescriptor;
    backend?: FakeAgentBackend;
  } = {}
): Promise<ObservedChat> {
  const session = new ObservedChat({
    backend: (options.backend ?? fake).backend,
    cwd: "/vault",
    internalId: `chat-${nextChat++}`,
    backendId: "fake",
    projectId: options.projectId,
    agentSlug: options.agentSlug,
    getDescriptor: options.descriptor ? () => options.descriptor : undefined,
  });
  await session.ready;
  if (options.listed !== false) listed.push(session);
  return session;
}

function untilAgentChatStarted(count = 1): Promise<AgentSession> {
  return new Promise((resolve) => {
    const wake = () => {
      if (started.length < count) return;
      startWaiters.delete(wake);
      resolve(started[count - 1]);
    };
    startWaiters.add(wake);
    wake();
  });
}

function untilStatus(
  session: AgentSession,
  wanted: (status: AgentSessionStatus) => boolean
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!wanted(session.getStatus())) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = session.subscribe({ onMessagesChanged: () => {}, onStatusChanged: check });
    check();
  });
}

const sessionIdOf = (session: AgentSession) => session.getBackendSessionId()!;

async function askedAndPrompted(
  parent: AgentSession,
  message = "What do you think of this plan?"
): Promise<AgentSession> {
  expect(chats.ask(parent, "Maya", message)).toEqual(expect.objectContaining({ kind: "asked" }));
  const maya = await untilAgentChatStarted(started.length + 1);
  await fake.untilPrompt(sessionIdOf(maya), fake.promptsTo(sessionIdOf(maya)).length + 1);
  return maya;
}

class ObservedChat extends AgentSession {
  private handedWaiters = new Set<() => void>();

  sendPrompt(
    ...args: Parameters<AgentSession["sendPrompt"]>
  ): ReturnType<AgentSession["sendPrompt"]> {
    const sent = super.sendPrompt(...args);
    this.handedWaiters.forEach((wake) => wake());
    this.handedWaiters.clear();
    return sent;
  }

  untilHanded(): Promise<void> {
    return new Promise((resolve) => this.handedWaiters.add(resolve));
  }
}

function mentionsOn(chat: AgentSession) {
  return chat.store.getDisplayMessages().find((m) => m.message.startsWith("@Maya"))?.agentMentions;
}

async function askFromMessage(): Promise<{ coco: ObservedChat; maya: AgentSession }> {
  const coco = await openChat({ agentSlug: "coco" });
  coco.sendPrompt("@Maya what do you think of this plan?");
  await fake.untilPrompt(sessionIdOf(coco));
  const maya = await askedAndPrompted(coco);
  return { coco, maya };
}

function answer(maya: AgentSession, text: string): void {
  fake.say(sessionIdOf(maya), text);
  fake.endTurn(sessionIdOf(maya));
}

beforeEach(async () => {
  setSettings({ copilotFolder: "copilot" });
  await setCustomAgentsAccess("team");
  vault = createFakeAgentVault();
  seedAgent("coco", "Coco", "You keep the whole vault in view.");
  seedAgent("maya", "Maya", "You pressure-test plans. Always name the biggest risk first.");
  store = new CustomAgentStore(vault.app);
  await store.start();
  fake = createFakeAgentBackend();
  listed = [];
  started = [];
  starts = [];
  startWaiters = new Set();
  startChat = jest.fn(async (start: HiddenChatStart) => {
    starts.push(start);
    const session = AgentSession.start({
      backend: fake.backend,
      cwd: "/vault",
      internalId: `hidden-${starts.length}`,
      backendId: "fake",
      projectId: start.projectId,
      agentSlug: start.agent.slug,
      agent: start.prompt,
      observeSessionEvent: start.observeSessionEvent,
    });
    await session.ready;
    started.push(session);
    startWaiters.forEach((wake) => wake());
    return session;
  });
  chats = new HiddenAgentChats({
    store: () => store,
    vaultBase: () => "/vault",
    listedChat: (chat) => listed.find((session) => session === chat) ?? null,
    startChat,
  });
});

afterEach(() => {
  chats.dispose();
  store.stop();
});

describe("hiddenAgentChats", () => {
  describe("HiddenAgentChats", () => {
    describe("ask()", () => {
      it(`returns at once, before the asked agent's chat has started (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        const result = chats.ask(coco, "Maya", "What do you think of this plan?");

        expect(result).toEqual({
          kind: "asked",
          agent: store.getAgents().find(({ slug }) => slug === "maya"),
        });
        expect(startChat).not.toHaveBeenCalled();
        await untilAgentChatStarted();
      });

      it(`starts the asked agent's chat with its own instruction and memory and no memory save rules (${ISSUE})`, async () => {
        vault.writeByHand("copilot/agents/maya/MEMORY.md", "Flag video length first.");
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "maya", "Review the plan.");
        await untilAgentChatStarted();

        const { prompt } = starts[0];
        expect(prompt.slug).toBe("maya");
        expect(prompt.prompt).toContain("Always name the biggest risk first.");
        expect(prompt.prompt).toContain("<memory>\nFlag video length first.\n</memory>");
        expect(prompt.prompt).not.toContain("Save a rule to your memory");
        expect(prompt.memoryPath).toBeUndefined();
      });

      it(`starts the asked agent's chat in the project and mode of the chat that asked (${ISSUE})`, async () => {
        const coco = await openChat({
          agentSlug: "coco",
          projectId: "launch",
          backend: createFakeAgentBackend(AUTO_MODE),
        });

        chats.ask(coco, "Maya", "Review the plan.");
        await untilAgentChatStarted();

        expect(starts[0]).toEqual(expect.objectContaining({ projectId: "launch", mode: "auto" }));
      });

      it(`sends the asked agent the message with who asked it and that it can't change its memory from there (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        const maya = await askedAndPrompted(coco);

        const [sent] = fake.promptsTo(sessionIdOf(maya));
        expect(sent).toContain("Coco asked you this for the user, from another chat.");
        expect(sent).toContain(
          "You can't save rules to your memory or change your instruction from this chat."
        );
        expect(sent).toContain(
          '<message from="Coco">\nWhat do you think of this plan?\n</message>'
        );
      });

      it(`names Copilot as the asker when a chat with no agent asks (${ISSUE})`, async () => {
        const copilot = await openChat();

        const maya = await askedAndPrompted(copilot);

        expect(fake.promptsTo(sessionIdOf(maya))[0]).toContain('<message from="Copilot">');
      });

      it(`relays the reply into the chat that asked, marked as the agent's reply, with the relay principle (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        answer(maya, "I disagree. Six features is too many.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        const [marker] = relayed.split("\n");
        expect(marker).toMatch(/^<!-- copilot-agent-reply \{.*\} -->$/);
        expect(
          JSON.parse(marker.slice("<!-- copilot-agent-reply ".length, -" -->".length))
        ).toMatchObject({ agent: "maya", name: "Maya" });
        expect(relayed).toContain("Maya replied. Pass the reply on to the user now.");
        expect(relayed).toContain(RELAY_PRINCIPLE);
        expect(relayed).toContain(
          '<agent-reply from="Maya">\nI disagree. Six features is too many.\n</agent-reply>'
        );
      });

      it(`carries the files the agent changed onto the relayed reply, for the Files changed card, and names them to the current agent (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Add one line to the plan.");
        const reply = maya.store.getDisplayMessages().at(-1)!;
        maya.store.setFileChanges(reply.id, [PLAN_CHANGE]);

        answer(maya, "Added the risk line.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        expect(relayed).toContain("Maya changed Plans/Launch plan.md.");
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.fileChanges).toEqual([PLAN_CHANGE]);
      });

      it(`carries the files onto a relayed reply that waited for a busy chat's turn to end (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Add one line to the plan.");
        coco.sendPrompt("Meanwhile, something else.");
        await fake.untilPrompt(sessionIdOf(coco));
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [PLAN_CHANGE]);
        const handed = coco.untilHanded();
        answer(maya, "Added the risk line.");
        await handed;

        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.fileChanges).toEqual([PLAN_CHANGE]);
      });

      it(`carries only the files changed since the latest ask when a continued chat's reply is relayed (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Add the risk line to the plan.");
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [PLAN_CHANGE]);
        answer(maya, "Added the risk line.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");
        const outro = {
          ...PLAN_CHANGE,
          before: PLAN_CHANGE.after,
          after: `${PLAN_CHANGE.after}Outro: 10 seconds.\n`,
        };

        chats.ask(coco, "Maya", "Add the outro line too.");
        await fake.untilPrompt(sessionIdOf(maya), 2);
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [outro]);
        answer(maya, "Added the outro line.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.fileChanges).toEqual([outro]);
      });

      it(`continues the same chat when the same chat asks the agent again after it finished (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "First question.");
        answer(maya, "First answer.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");

        expect(chats.ask(coco, "Maya", "Second question.")).toEqual(
          expect.objectContaining({ kind: "asked" })
        );

        expect(await fake.untilPrompt(sessionIdOf(maya), 2)).toContain("Second question.");
        expect(startChat).toHaveBeenCalledTimes(1);
      });

      it(`switches a continued chat to the mode the asking chat is in now (${ISSUE})`, async () => {
        fake = createFakeAgentBackend({
          model: null,
          mode: {
            current: "default",
            options: [],
            apply: { auto: { kind: "setMode", nativeId: "auto" } },
          },
        });
        let parentMode: BackendState = {
          model: null,
          mode: { current: "default", options: [], apply: {} },
        };
        const coco = await openChat({ agentSlug: "coco" });
        jest.spyOn(coco, "getState").mockImplementation(() => parentMode);
        const maya = await askedAndPrompted(coco, "First question.");
        answer(maya, "First answer.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");
        expect(fake.setSessionMode).not.toHaveBeenCalled();

        parentMode = AUTO_MODE;
        chats.ask(coco, "Maya", "Now edit the plan.");
        await fake.untilPrompt(sessionIdOf(maya), 2);

        expect(fake.setSessionMode).toHaveBeenCalledWith({
          sessionId: sessionIdOf(maya),
          modeId: "auto",
        });
        expect(maya.getState()?.mode?.current).toBe("auto");
      });

      it(`turns down asking the same agent again while it still works on the first request (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "First question.");

        expect(chats.ask(coco, "Maya", "Second question.")).toEqual(
          expect.objectContaining({ kind: "busy" })
        );
        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
      });

      it(`starts one chat per asking chat and agent, so another chat asking the same agent gets its own (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const copilot = await openChat();

        chats.ask(coco, "Maya", "From Coco.");
        chats.ask(copilot, "Maya", "From Copilot.");

        await untilAgentChatStarted(2);
        expect(started[0]).not.toBe(started[1]);
      });

      it(`waits for the turn that reports a background task before it relays, leaving the task's own text out (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        const id = sessionIdOf(maya);
        fake.emit(id, {
          sessionUpdate: "task_started",
          taskId: "task-1",
          toolCallId: "tool-1",
          kind: "subagent",
          description: "Research",
        });
        answer(maya, "Checking the numbers.");
        fake.emit(
          id,
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "task notes" } },
          "tool-1"
        );

        expect(chats.ask(coco, "Maya", "Again?")).toEqual(
          expect.objectContaining({ kind: "busy" })
        );
        expect(fake.promptsTo(sessionIdOf(coco))).toEqual([]);

        fake.emit(id, { sessionUpdate: "task_ended", taskId: "task-1", status: "completed" });
        fake.emit(id, { sessionUpdate: "turn_started", turnId: "report" });
        fake.say(id, "The numbers hold.");
        fake.emit(id, { sessionUpdate: "turn_ended", turnId: "report", stopReason: "end_turn" });

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        expect(relayed).toContain("Checking the numbers.\n\nThe numbers hold.");
        expect(relayed).not.toContain("task notes");
      });

      it(`relays that the agent didn't finish when its chat disconnects, as when its process dies (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        fake.emit(sessionIdOf(maya), {
          sessionUpdate: "session_disconnected",
          error: new Error("Claude stopped unexpectedly."),
        });

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          "Maya didn't finish (Claude stopped unexpectedly.). Tell the user how far Maya got and why."
        );
      });

      it(`starts a new chat for the next ask after the earlier one closed, as when its process died (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const first = await askedAndPrompted(coco, "First question.");
        await first.dispose();
        await fake.untilPrompt(sessionIdOf(coco));

        chats.ask(coco, "Maya", "Second question.");

        expect(await untilAgentChatStarted(2)).not.toBe(first);
      });

      it(`relays that the agent didn't finish when its chat closes mid-run, as when its Codex or OpenCode process exits (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        await maya.dispose();

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          "Maya didn't finish (Maya's chat stopped before it finished.)."
        );
      });

      it(`relays that the agent didn't start when its message ends without a turn, as when its chat refuses it (${ISSUE})`, async () => {
        startChat.mockImplementationOnce(async (start) => {
          const session = AgentSession.start({
            backend: fake.backend,
            cwd: "/vault",
            internalId: "hidden-refusing",
            backendId: "fake",
            agent: start.prompt,
            observeSessionEvent: start.observeSessionEvent,
          });
          await session.ready;
          jest
            .spyOn(session, "sendPrompt")
            .mockReturnValue({ userMessageId: "refused", turn: Promise.resolve("refusal") });
          return session;
        });
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "Maya", "Review the plan.");

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          "Maya didn't finish (Maya didn't start.)."
        );
      });

      it(`relays that the agent didn't finish when its files can't be read to start its chat (${ISSUE})`, async () => {
        chats.dispose();
        chats = new HiddenAgentChats({
          store: () => store,
          vaultBase: () => null,
          listedChat: (chat) => listed.find((session) => session === chat) ?? null,
          startChat,
        });
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "Maya", "Review the plan.");

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          "Maya didn't finish (Maya couldn't be loaded.)."
        );
        expect(startChat).not.toHaveBeenCalled();
      });

      it(`finds the agent by its name when its folder has another name (${ISSUE})`, async () => {
        seedAgent("leo-books", "Leo", "You reconcile the books.");
        store.stop();
        await store.start();
        const coco = await openChat({ agentSlug: "coco" });

        expect(chats.ask(coco, "Leo", "Reconcile October.")).toMatchObject({
          kind: "asked",
          agent: { slug: "leo-books" },
        });
        await untilAgentChatStarted();
      });

      it(`finds the agent by its name before another agent whose folder has that name, as after Maya is renamed Nora and a new Maya is made (${ISSUE})`, async () => {
        seedAgent("maya-2", "Maya", "You are the new Maya.");
        seedAgent("maya", "Nora", "You were Maya.");
        store.stop();
        await store.start();
        const coco = await openChat({ agentSlug: "coco" });

        expect(chats.ask(coco, "Maya", "Plan the launch.")).toMatchObject({
          kind: "asked",
          agent: { slug: "maya-2" },
        });
        await untilAgentChatStarted();
      });

      it(`holds the reply while a Codex or OpenCode chat is busy and sends it as the next turn (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        coco.sendPrompt("While she reads: what date did we lock?");
        await fake.untilPrompt(sessionIdOf(coco));
        const handed = coco.untilHanded();

        answer(maya, "Too many features.");
        await handed;
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
        fake.endTurn(sessionIdOf(coco));

        expect(await fake.untilPrompt(sessionIdOf(coco), 2)).toContain("Too many features.");
      });

      it(`waits for a busy Claude chat's turn to end instead of handing the reply in mid-turn, so Stop can't put it in the user's draft (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco", descriptor: CLAUDE_LIKE });
        const maya = await askedAndPrompted(coco);
        coco.sendPrompt("While she reads: what date did we lock?");
        await fake.untilPrompt(sessionIdOf(coco));
        let queuedMidTurn = false;
        coco.subscribe({
          onMessagesChanged: () => {},
          onStatusChanged: () => {},
          onQueuedPromptsChanged: () => {
            queuedMidTurn ||= coco.getQueuedPrompts().length > 0;
          },
        });

        answer(maya, "Too many features.");
        await untilStatus(maya, (status) => status === "idle");
        fake.endTurn(sessionIdOf(coco));

        expect(await fake.untilPrompt(sessionIdOf(coco), 2)).toContain("Too many features.");
        expect(queuedMidTurn).toBe(false);
      });

      it(`sends the reply again when Stop drops it before it reached the agent (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        coco.sendPrompt("Something long.");
        await fake.untilPrompt(sessionIdOf(coco));
        const handed = coco.untilHanded();
        answer(maya, "Too many features.");
        await handed;

        await coco.cancel();

        expect(await fake.untilPrompt(sessionIdOf(coco), 2)).toContain("Too many features.");
      });

      it(`drops the reply without an error when the chat that asked closes while it waits (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco", descriptor: CLAUDE_LIKE });
        const maya = await askedAndPrompted(coco);
        coco.sendPrompt("Something long.");
        await fake.untilPrompt(sessionIdOf(coco));
        answer(maya, "Too many features.");
        await untilStatus(maya, (status) => status === "idle");

        await coco.dispose();

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
      });

      it(`turns down an agent asking itself (${ISSUE})`, async () => {
        const maya = await openChat({ agentSlug: "maya" });

        expect(chats.ask(maya, "@Maya", "Review.")).toEqual(
          expect.objectContaining({ kind: "self" })
        );
        expect(startChat).not.toHaveBeenCalled();
      });

      it(`turns down a chat no list shows, such as an asked agent's own chat (${ISSUE})`, async () => {
        const hidden = await openChat({ agentSlug: "maya", listed: false });

        expect(chats.ask(hidden, "Coco", "Help.")).toEqual({ kind: "not_from_here" });
        expect(chats.ask(null, "Coco", "Help.")).toEqual({ kind: "not_from_here" });
      });

      it("names the agents the chat can ask when no agent has the name", async () => {
        const coco = await openChat({ agentSlug: "coco" });

        expect(chats.ask(coco, "Leo", "Books?")).toEqual({
          kind: "unknown_agent",
          roster: [expect.objectContaining({ slug: "maya" })],
        });
      });

      it(`turns down asking while custom agents are not available (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        await setCustomAgentsAccess("free");

        expect(chats.ask(coco, "Maya", "Review.")).toEqual({ kind: "unavailable" });
      });

      it(`stops each asked agent's chat when the chat that asked closes for good (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        await coco.dispose();

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.closeSession).toHaveBeenCalledWith({ sessionId: sessionIdOf(maya) });
      });

      it(`stops every asked agent's chat and relays nothing when custom agents stop being available before it finishes (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        await setCustomAgentsAccess("free");

        await untilStatus(maya, (status) => status === "closed");
        expect(coco.store.getDisplayMessages()).toEqual([]);
      });

      it(`saves the run as working with its hidden chat, then finished with when it ended (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        const [working] = mentionsOn(coco) ?? [];
        expect(working).toMatchObject({
          agent: "maya",
          name: "Maya",
          status: "working",
          chat: { backendId: "fake", sessionId: sessionIdOf(maya) },
        });
        expect(working.endedAt).toBeUndefined();

        answer(maya, "Too many features.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        const [finished] = mentionsOn(coco) ?? [];
        expect(finished).toMatchObject({ id: working.id, status: "finished" });
        expect(finished.endedAt).toBeGreaterThanOrEqual(working.startedAt);
      });

      it(`saves that the agent didn't finish because Copilot turned a request down (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();
        const request = { ...writePermissionRequest(), sessionId: sessionIdOf(maya) };
        await chats.answerPermission(request);

        answer(maya, "I couldn't add the line.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        expect(mentionsOn(coco)?.[0]).toEqual(
          expect.objectContaining({
            status: "didnt_finish",
            end: { kind: "permission_denied", requests: [request.toolCall.title] },
          })
        );
      });

      it(`saves that the agent didn't finish, and why, when its chat disconnects (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        fake.emit(sessionIdOf(maya), {
          sessionUpdate: "session_disconnected",
          error: new Error("Claude stopped unexpectedly."),
        });
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        expect(mentionsOn(coco)?.[0]).toEqual(
          expect.objectContaining({
            status: "didnt_finish",
            end: { kind: "error", message: "Claude stopped unexpectedly." },
          })
        );
      });

      it(`saves and relays nothing for a run that ends after the license lapsed without notice, which its note then reads as didn't finish (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();
        const gateRead = new Promise<void>((resolve) =>
          jest.spyOn(customAgentsGate, "getCustomAgentsGate").mockImplementation(() => {
            resolve();
            return "hidden";
          })
        );

        try {
          answer(maya, "Too many features.");
          await gateRead;
        } finally {
          jest.mocked(customAgentsGate.getCustomAgentsGate).mockRestore();
        }

        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "working" }));
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
      });

      it(`leaves the run working when the chat that asked closes, which its note then reads as didn't finish (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        await coco.dispose();
        await untilStatus(maya, (status) => status === "closed");

        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "working" }));
      });
    });

    describe("answerPermission()", () => {
      it(`turns down a request from an asked agent's chat with the reason, and leaves other chats' requests alone (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        const request: PermissionPrompt = {
          ...writePermissionRequest(),
          sessionId: sessionIdOf(maya),
        };

        await expect(chats.answerPermission(request)).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
          denyMessage: HIDDEN_CHAT_DENY_MESSAGE,
        });
        expect(chats.answerPermission({ ...request, sessionId: sessionIdOf(coco) })).toBeNull();
      });

      it(`reports each turned-down request to the chat that asked when the agent's reply comes back (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        const request = { ...writePermissionRequest(), sessionId: sessionIdOf(maya) };
        await chats.answerPermission(request);

        answer(maya, "I couldn't add the line.");

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          `<turned-down from="Maya">\n${request.toolCall.title}\n</turned-down>`
        );
      });
    });

    describe("dispose()", () => {
      it(`stops and closes each asked agent's chat on unload, and relays nothing (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        chats.dispose();

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.cancel).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: sessionIdOf(maya) })
        );
        expect(fake.closeSession).toHaveBeenCalledWith({ sessionId: sessionIdOf(maya) });
        expect(fake.promptsTo(sessionIdOf(coco))).toEqual([]);
      });

      it(`relays nothing for an asked agent whose chat fails to start after unload stopped it (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const startCalled = new Promise<(error: Error) => void>((resolve) =>
          startChat.mockImplementationOnce(() => new Promise((_, reject) => resolve(reject)))
        );
        chats.ask(coco, "Maya", "What do you think of this plan?");
        const failStart = await startCalled;

        chats.dispose();
        failStart(new Error("AgentSessionManager was shut down during session creation"));

        const maya = await askedAndPrompted(coco, "And the intro?");
        const handed = coco.untilHanded();
        answer(maya, "Cut it.");
        await handed;
        expect(fake.promptsTo(sessionIdOf(coco))).toEqual([expect.stringContaining("Cut it.")]);
      });
    });
  });
});
