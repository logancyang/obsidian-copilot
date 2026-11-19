import { AgentSession, type AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { BackendDescriptor, BackendState } from "@/agentMode/session/types";
import { HiddenAgentChats, type HiddenChatStart } from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const AUTO_MODE: BackendState = { model: null, mode: { current: "auto", options: [], apply: {} } };

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

afterEach(() => store.stop());

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

      it(`closes the asked agent's chat once its reply comes back, and starts a new one for the next ask (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const first = await askedAndPrompted(coco, "First question.");

        answer(first, "First answer.");
        await fake.untilPrompt(sessionIdOf(coco));

        await untilStatus(first, (status) => status === "closed");
        expect(fake.closeSession).toHaveBeenCalledWith({ sessionId: sessionIdOf(first) });
        fake.endTurn(sessionIdOf(coco));
        chats.ask(coco, "Maya", "Second question.");
        expect(await untilAgentChatStarted(2)).not.toBe(first);
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

      it(`relays nothing when custom agents stop being available before the agent finishes (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        await setCustomAgentsAccess("free");

        answer(maya, "Too many features.");
        await untilStatus(maya, (status) => status === "closed");

        expect(coco.store.getDisplayMessages()).toEqual([]);
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
    });
  });
});
