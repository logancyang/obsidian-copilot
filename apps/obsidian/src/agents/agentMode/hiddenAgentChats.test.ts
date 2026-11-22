import { AgentSession, type AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentSessionIndex } from "@/agentMode/session/AgentSessionIndex";
import { createMemorySessionIndex } from "@/agentMode/session/testing/memorySessionIndex";
import { writePermissionRequest } from "@/agentMode/session/testing/permissionPrompts";
import type { BackendDescriptor, BackendState, PermissionPrompt } from "@/agentMode/session/types";
import {
  HiddenAgentChats,
  readAskedMessage,
  type HiddenChatStart,
} from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import { CustomAgentStore, type CustomAgent } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import * as customAgentsGate from "@/agents/customAgentsGate";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setSettings } from "@/settings/model";
import { FileSystemAdapter, type App } from "obsidian";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const LOCKED_AGENTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const CONTROL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/945";
const RUNNING = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";
const PERMISSION = "https://github.com/Brevilabs/obsidian-copilot-private/issues/946";
const SEVERAL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/949";
const ASKED_MEMORY = "https://github.com/Brevilabs/obsidian-copilot-private/issues/969";
const SETUP = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";
const NO_NOTE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/976";
const RECALL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/980";
const ENTRIES = "https://github.com/Brevilabs/obsidian-copilot-private/issues/991";
const AUTO_MODE: BackendState = { model: null, mode: { current: "auto", options: [], apply: {} } };
const PLAN: BackendState = { model: null, mode: { current: "plan", options: [], apply: {} } };
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
let unavailableReason: jest.Mock<string | null, [CustomAgent]>;
let index: AgentSessionIndex;
let nextChat = 1;

function seedAgent(slug: string, name: string, instruction: string): void {
  vault.writeByHand(
    `copilot/teammates/${slug}/instructions.md`,
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

function agentNamed(name: string) {
  return store.getAgents().find((agent) => agent.name === name);
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

async function waitingOnQuestion(): Promise<{ coco: ObservedChat; maya: AgentSession }> {
  const { coco, maya } = await askFromMessage();
  chats.askUser(maya, "October or November?");
  fake.say(sessionIdOf(maya), "Waiting for the user.");
  fake.endTurn(sessionIdOf(maya));
  fake.endTurn(sessionIdOf(coco));
  await fake.untilPrompt(sessionIdOf(coco), 2);
  fake.endTurn(sessionIdOf(coco));
  return { coco, maya };
}

function requestFrom(maya: AgentSession, toolCallId = "tc-write"): PermissionPrompt {
  const request = writePermissionRequest();
  return {
    ...request,
    sessionId: sessionIdOf(maya),
    toolCall: { ...request.toolCall, toolCallId },
  };
}

function answer(maya: AgentSession, text: string): void {
  fake.say(sessionIdOf(maya), text);
  fake.endTurn(sessionIdOf(maya));
}

interface TwoAsked {
  coco: ObservedChat;
  maya: AgentSession;
  leo: AgentSession;
}

function agentChat(slug: string): Promise<AgentSession> {
  return new Promise((resolve) => {
    const wake = () => {
      const chat = started.find((session) => session.agentSlug === slug);
      if (!chat) return;
      startWaiters.delete(wake);
      resolve(chat);
    };
    startWaiters.add(wake);
    wake();
  });
}

async function askBoth(descriptor?: BackendDescriptor): Promise<TwoAsked> {
  seedAgent("leo", "Leo", "You keep the company books.");
  store.stop();
  await store.start();
  const coco = await openChat({ agentSlug: "coco", descriptor });
  coco.sendPrompt("@Maya @Leo does the $8k launch budget hold up?");
  await fake.untilPrompt(sessionIdOf(coco));
  chats.ask(coco, "Maya", "Is $8k right for the launch?");
  chats.ask(coco, "Leo", "Does the Q4 marketing line cover $8k?");
  const maya = await agentChat("maya");
  const leo = await agentChat("leo");
  await fake.untilPrompt(sessionIdOf(maya));
  await fake.untilPrompt(sessionIdOf(leo));
  return { coco, maya, leo };
}

function markerOf(relay: string): Record<string, unknown> {
  const marker = relay.split("\n")[0];
  return JSON.parse(marker.slice("<!-- copilot-teammate-reply ".length, -" -->".length)) as Record<
    string,
    unknown
  >;
}

function relayedFrom(relay: string): string {
  const marker = relay.split("\n")[0];
  return (
    JSON.parse(marker.slice("<!-- copilot-teammate-reply ".length, -" -->".length)) as {
      teammate: string;
    }
  ).teammate;
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
  unavailableReason = jest.fn((_agent: CustomAgent): string | null => null);
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
  index = createMemorySessionIndex();
  chats = new HiddenAgentChats({
    store: () => store,
    vaultBase: () => "/vault",
    listedChat: (chat) => listed.find((session) => session === chat) ?? null,
    unavailableReason,
    startChat,
    askedConversations: index,
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

      it(`turns down an agent whose model can't run on this device with the reason, and starts no chat in its place (${SETUP})`, async () => {
        unavailableReason.mockImplementation((agent) =>
          agent.slug === "maya" ? "Maya runs on OpenCode, which isn't set up on this device." : null
        );
        const coco = await openChat({ agentSlug: "coco" });

        const result = chats.ask(coco, "Maya", "What do you think of this plan?");

        expect(result).toEqual({
          kind: "cannot_run",
          agent: store.getAgents().find(({ slug }) => slug === "maya"),
          reason: "Maya runs on OpenCode, which isn't set up on this device.",
        });
        expect(startChat).not.toHaveBeenCalled();
      });

      it(`starts the asked agent's chat with its own instruction, memory and save rules (${ASKED_MEMORY})`, async () => {
        vault.writeByHand("copilot/teammates/maya/MEMORY.md", "Flag video length first.");
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "maya", "Review the plan.");
        await untilAgentChatStarted();

        const { prompt } = starts[0];
        expect(prompt.slug).toBe("maya");
        expect(prompt.prompt).toContain("Always name the biggest risk first.");
        expect(prompt.prompt).toContain("<memory>\nFlag video length first.\n</memory>");
        expect(prompt.prompt).toContain("Save a rule to your memory only when");
        expect(prompt.prompt).not.toContain("ask_teammate");
      });

      it(`starts the asked agent's chat on its own prompt variant, so a coding agent that stores prompts by agent keeps it apart from the agent's own chat (${ENTRIES})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "maya", "Review the plan.");
        await untilAgentChatStarted();

        expect(starts[0].prompt).toEqual(
          expect.objectContaining({ slug: "maya", variant: "asked" })
        );
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

      it(`sends the asked agent the message with who asked it, and nothing that keeps it from saving a rule (${ASKED_MEMORY})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        const maya = await askedAndPrompted(coco);

        const [sent] = fake.promptsTo(sessionIdOf(maya));
        expect(sent).toContain("Coco asked you this for the user, from another chat.");
        expect(sent).not.toContain("memory");
        expect(sent).toContain(
          '<message from="Coco">\nWhat do you think of this plan?\n</message>'
        );
      });

      it(`tells the asked agent that Copilot turns down any change while the chat that asked is in Plan mode, and says nothing of it otherwise (${ENTRIES})`, async () => {
        const planning = await openChat({
          agentSlug: "coco",
          backend: createFakeAgentBackend(PLAN),
        });
        const plain = await openChat();

        const [toPlanning] = fake.promptsTo(sessionIdOf(await askedAndPrompted(planning)));
        const [toPlain] = fake.promptsTo(sessionIdOf(await askedAndPrompted(plain)));

        expect(toPlanning).toContain(
          "The chat that asked you is in Plan mode, so Copilot turns down any change you try. Say in your reply what you would change."
        );
        expect(toPlain).not.toContain("Plan mode");
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
        expect(marker).toMatch(/^<!-- copilot-teammate-reply \{.*\} -->$/);
        expect(
          JSON.parse(marker.slice("<!-- copilot-teammate-reply ".length, -" -->".length))
        ).toMatchObject({ teammate: "maya", name: "Maya" });
        expect(relayed).toContain("Maya replied. Pass the reply on to the user now.");
        expect(relayed).toContain(RELAY_PRINCIPLE);
        expect(relayed).toContain(
          '<teammate-reply from="Maya">\nI disagree. Six features is too many.\n</teammate-reply>'
        );
      });

      it(`names in each relay's marker the run's ending and the asked agent's chat, as the asking message saves them, for its question and then its reply (${NO_NOTE})`, async () => {
        const { coco, maya } = await waitingOnQuestion();
        const chat = { backendId: "fake", sessionId: sessionIdOf(maya) };
        const question = fake.promptsTo(sessionIdOf(coco))[1];

        chats.answer(coco, "Maya", "October.");
        await fake.untilPrompt(sessionIdOf(maya), 2);
        answer(maya, "All matched.");
        const reply = await fake.untilPrompt(sessionIdOf(coco), 3);

        expect(markerOf(question)).toMatchObject({ status: "question", chat });
        expect(markerOf(reply)).toMatchObject({ status: "finished", chat });
        expect(mentionsOn(coco)?.[0]).toMatchObject({ status: "finished", chat });
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

      it(`carries the rule the agent saved through save_memory onto the relayed reply, as its own chat shows it, even when the run changed no file (${ASKED_MEMORY}, https://github.com/Brevilabs/obsidian-copilot-private/issues/988)`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "From now on, flag the budget first.");
        const save = {
          rule: "Flag the budget first.",
          replaced: "Flag video length first.",
          agentName: "Maya",
          memoryPath: "copilot/teammates/maya/MEMORY.md",
        };
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [], [save]);

        answer(maya, "Noted.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.memorySaves).toEqual([save]);
        expect(relayMessage?.fileChanges).toEqual([]);
        expect(relayed).not.toContain("MEMORY.md");
      });

      it(`names to the asking agent a direct edit of the asked agent's MEMORY.md like any other changed file (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Tidy your memory file.");
        const memory = {
          path: "copilot/teammates/maya/MEMORY.md",
          status: "modified" as const,
          before: "## How to work\n\nFlag video length first.\n",
          after: "## How to work\n",
          additions: 0,
          deletions: 2,
        };
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [memory]);

        answer(maya, "Done.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayed).toContain("Maya changed copilot/teammates/maya/MEMORY.md.");
        expect(relayMessage?.fileChanges).toEqual([memory]);
        expect(relayMessage?.memorySaves).toBeUndefined();
      });

      it(`carries no saves onto a relayed reply whose run left the agent's memory alone (${ASKED_MEMORY})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Add one line to the plan.");
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [PLAN_CHANGE]);

        answer(maya, "Added the risk line.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.memorySaves).toBeUndefined();
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

      it(`records the conversation when the ask starts, with the asked agent, who asked, the asking chat and the first ask, then its answer and that it finished (${RECALL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Is $8k right for the launch?");

        const [asked] = await index.getAskedConversations();
        expect(asked).toEqual({
          backendId: "fake",
          sessionId: sessionIdOf(maya),
          agent: "maya",
          askedBy: "coco",
          askedIn: { backendId: "fake", sessionId: sessionIdOf(coco) },
          firstAtMs: asked.lastAtMs,
          lastAtMs: asked.lastAtMs,
          asks: 1,
          firstAsk: "Is $8k right for the launch?",
        });
        expect(asked.lastAtMs).toBeGreaterThan(0);

        answer(maya, "Yes, if the video\nstays under two minutes.");
        await fake.untilPrompt(sessionIdOf(coco));

        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({
            latestAnswer: "Yes, if the video stays under two minutes.",
            ending: "finished",
          }),
        ]);
        expect(await index.getEntries()).toEqual([]);
      });

      it(`counts a second ask in the same conversation on its one record, keeping the first ask and clearing the earlier answer until the new run ends (${RECALL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "First question.");
        answer(maya, "First answer.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");

        chats.ask(coco, "Maya", "Second question.");
        await fake.untilPrompt(sessionIdOf(maya), 2);

        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({ asks: 2, firstAsk: "First question." }),
        ]);
        expect((await index.getAskedConversations())[0].latestAnswer).toBeUndefined();
        answer(maya, "Second answer.");
        await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({ asks: 2, latestAnswer: "Second answer.", ending: "finished" }),
        ]);
      });

      it(`records Copilot as the asker, by leaving the asker out, when a chat with no agent asks (${RECALL})`, async () => {
        const copilot = await openChat();

        await askedAndPrompted(copilot);

        expect((await index.getAskedConversations())[0].askedBy).toBeUndefined();
      });

      it(`cuts the ask and the answer to 300 characters at a word boundary, and one long word at the limit (${RECALL})`, async () => {
        const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, words);
        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");
        chats.ask(coco, "Maya", "x".repeat(400));
        await fake.untilPrompt(sessionIdOf(maya), 2);
        answer(maya, "y".repeat(400));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        const [{ firstAsk, latestAnswer }] = await index.getAskedConversations();
        expect(firstAsk).toBe(`${words.slice(0, words.lastIndexOf(" ", 300))} ...`);
        expect(latestAnswer).toBe(`${"y".repeat(300)}...`);
      });

      it(`cuts Chinese text without spaces at the 300-character limit (${RECALL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "预算够吗？");
        answer(maya, "预算".repeat(200));
        await fake.untilPrompt(sessionIdOf(coco));

        expect((await index.getAskedConversations())[0].latestAnswer).toBe(
          `${"预算".repeat(150)}...`
        );
      });

      it(`records that the run didn't finish, with what the agent had written, when its chat disconnects (${RECALL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        fake.say(sessionIdOf(maya), "Halfway through.");

        fake.emit(sessionIdOf(maya), {
          sessionUpdate: "session_disconnected",
          error: new Error("Claude stopped unexpectedly."),
        });
        await fake.untilPrompt(sessionIdOf(coco));

        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({ latestAnswer: "Halfway through.", ending: "didnt_finish" }),
        ]);
      });

      it(`keeps what a run cut off by its asking chat closing was asked, with no answer or ending, which its line reads as not finished (${RECALL})`, async () => {
        const { coco, maya } = await askFromMessage();

        await coco.dispose();
        await untilStatus(maya, (status) => status === "closed");

        const [asked] = await index.getAskedConversations();
        expect(asked.firstAsk).toBe("What do you think of this plan?");
        expect(asked.ending).toBeUndefined();
        expect(asked.latestAnswer).toBeUndefined();
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

      it(`sends a new message for an agent that still works into the same chat, after its current step on Codex or OpenCode, and relays once both are done (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Review the plan.");
        fake.say(sessionIdOf(maya), "Reading the plan.");

        expect(chats.ask(coco, "Maya", "Skip the outro for now.")).toEqual({
          kind: "sent",
          agent: agentNamed("Maya"),
          now: false,
        });
        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
        fake.endTurn(sessionIdOf(maya));

        const redirected = await fake.untilPrompt(sessionIdOf(maya), 2);
        expect(redirected).toContain("Coco sent you more from the user while you work.");
        expect(redirected).toContain('<message from="Coco">\nSkip the outro for now.\n</message>');
        expect(fake.promptsTo(sessionIdOf(coco))).toEqual([]);
        answer(maya, "Skipped the outro.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        expect(relayed).toContain("Reading the plan.\n\nSkipped the outro.");
        expect(startChat).toHaveBeenCalledTimes(1);
      });

      it(`says a new message reaches a working agent now when its chat reads messages mid-turn, as on Claude (${CONTROL})`, async () => {
        startChat.mockImplementationOnce(async (start) => {
          const session = AgentSession.start({
            backend: fake.backend,
            cwd: "/vault",
            internalId: "hidden-claude",
            backendId: "fake",
            agent: start.prompt,
            observeSessionEvent: start.observeSessionEvent,
            getDescriptor: () => CLAUDE_LIKE,
          });
          await session.ready;
          started.push(session);
          startWaiters.forEach((wake) => wake());
          return session;
        });
        const coco = await openChat({ agentSlug: "coco" });
        await askedAndPrompted(coco, "Review the plan.");

        expect(chats.ask(coco, "Maya", "Skip the outro.")).toEqual(
          expect.objectContaining({ kind: "sent", now: true })
        );
      });

      it(`turns down a message for an agent waiting on the user's answer to its question, sending it nothing and leaving the question open, so the answer still reaches it (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();

        expect(chats.ask(coco, "Maya", "October or November?")).toEqual({
          kind: "awaiting_answer",
          agent: agentNamed("Maya"),
          question: "October or November?",
        });

        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
        expect(mentionsOn(coco)?.[0].status).toBe("question");
        expect(chats.answer(coco, "Maya", "October.")).toMatchObject({ kind: "answered" });
        expect(await fake.untilPrompt(sessionIdOf(maya), 2)).toContain(
          '<answer from="user">\nOctober.\n</answer>'
        );
        answer(maya, "Added it to October.");
        expect(await fake.untilPrompt(sessionIdOf(coco), 3)).toContain("Added it to October.");
        expect(mentionsOn(coco)?.[0].status).toBe("finished");
      });

      it(`sends a new message on to an agent working again after the user's answer, as for any working agent (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();
        chats.answer(coco, "Maya", "October.");
        await fake.untilPrompt(sessionIdOf(maya), 2);

        expect(chats.ask(coco, "Maya", "Also add Figma.")).toMatchObject({ kind: "sent" });

        fake.endTurn(sessionIdOf(maya));
        expect(await fake.untilPrompt(sessionIdOf(maya), 3)).toContain(
          '<message from="Coco">\nAlso add Figma.\n</message>'
        );
      });

      it(`continues the same chat when asked again after the user stopped an agent that waited on a question (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();
        chats.stop(coco, "Maya");
        await fake.untilPrompt(sessionIdOf(coco), 3);
        fake.endTurn(sessionIdOf(coco));

        expect(chats.ask(coco, "Maya", "Add it to October.")).toMatchObject({ kind: "asked" });

        expect(await fake.untilPrompt(sessionIdOf(maya), 2)).toContain("Add it to October.");
        expect(startChat).toHaveBeenCalledTimes(1);
      });

      it(`carries on the agent's earlier conversation saved on the asking chat when no chat with it is open, as after a restart (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        coco.sendPrompt("@Maya what do you think?");
        await fake.untilPrompt(sessionIdOf(coco));
        const asked = coco.store.getDisplayMessages()[0];
        coco.setAgentMentions(asked.id, [
          {
            id: "earlier",
            agent: "maya",
            name: "Maya",
            status: "didnt_finish",
            startedAt: 1,
            chat: { backendId: "claude", sessionId: "maya-earlier" },
          },
        ]);

        chats.ask(coco, "Maya", "And now?");
        await untilAgentChatStarted();

        expect(starts[0]).toEqual(
          expect.objectContaining({
            resume: { backendId: "claude", sessionId: "maya-earlier" },
            askedFrom: "fake",
          })
        );
      });

      it(`starts a new conversation when the asking chat never asked the agent (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        chats.ask(coco, "Maya", "Review the plan.");
        await untilAgentChatStarted();

        expect(starts[0].resume).toBeUndefined();
      });

      it(`leaves the history a carried-on chat replays as it opens out of the run's reply (${CONTROL})`, async () => {
        startChat.mockImplementationOnce(async (start) => {
          const session = AgentSession.start({
            backend: fake.backend,
            cwd: "/vault",
            internalId: "hidden-resumed",
            backendId: "fake",
            agent: start.prompt,
            observeSessionEvent: start.observeSessionEvent,
          });
          await session.ready;
          start.observeSessionEvent({
            sessionId: session.getBackendSessionId()!,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "An old reply." },
            },
          });
          started.push(session);
          startWaiters.forEach((wake) => wake());
          return session;
        });
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        answer(maya, "A new reply.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco));
        expect(relayed).toContain("A new reply.");
        expect(relayed).not.toContain("An old reply.");
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
          unavailableReason,
          startChat,
          askedConversations: index,
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

      it(`starts its own chat for each agent one message mentions, sends each only its own message, and saves both runs on that message (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();

        expect(maya).not.toBe(leo);
        expect(starts.map(({ prompt }) => prompt.slug).sort()).toEqual(["leo", "maya"]);
        const [toMaya] = fake.promptsTo(sessionIdOf(maya));
        const [toLeo] = fake.promptsTo(sessionIdOf(leo));
        expect(toMaya).toContain("Is $8k right for the launch?");
        expect(toMaya).not.toContain("Q4 marketing line");
        expect(toLeo).toContain("Does the Q4 marketing line cover $8k?");
        expect(toLeo).not.toContain("Is $8k right");
        expect(mentionsOn(coco)).toEqual([
          expect.objectContaining({ agent: "maya", status: "working" }),
          expect.objectContaining({ agent: "leo", status: "working" }),
        ]);
      });

      it(`relays the first reply as soon as it is in, saying the other agent still works, then the second as a message of its own (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();
        fake.endTurn(sessionIdOf(coco));

        answer(maya, "$8k is fine, drop the paid ads.");

        const first = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayedFrom(first)).toBe("maya");
        expect(first).toContain("$8k is fine, drop the paid ads.");
        expect(first).toContain("Leo is still working on what you asked.");
        expect(mentionsOn(coco)?.map(({ status }) => status)).toEqual(["finished", "working"]);
        fake.endTurn(sessionIdOf(coco));

        answer(leo, "The line has $6,200 left.");

        const second = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayedFrom(second)).toBe("leo");
        expect(second).toContain("The line has $6,200 left.");
        expect(second).not.toContain("drop the paid ads");
        expect(second).not.toContain("still working");
        expect(mentionsOn(coco)?.map(({ status }) => status)).toEqual(["finished", "finished"]);
      });

      it(`passes two replies that come in during a Claude chat's turn one turn each, in the order they came (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth(CLAUDE_LIKE);
        let queuedMidTurn = false;
        coco.subscribe({
          onMessagesChanged: () => {},
          onStatusChanged: () => {},
          onQueuedPromptsChanged: () => {
            queuedMidTurn ||= coco.getQueuedPrompts().length > 0;
          },
        });

        answer(leo, "The line has $6,200 left.");
        answer(maya, "$8k is fine, drop the paid ads.");
        await untilStatus(maya, (status) => status === "idle");
        await untilStatus(leo, (status) => status === "idle");
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
        fake.endTurn(sessionIdOf(coco));

        const first = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayedFrom(first)).toBe("leo");
        expect(first).not.toContain("drop the paid ads");
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(2);
        fake.endTurn(sessionIdOf(coco));

        expect(relayedFrom(await fake.untilPrompt(sessionIdOf(coco), 3))).toBe("maya");
        expect(queuedMidTurn).toBe(false);
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

      it(`turns down asking while custom agents are locked (${ISSUE}, ${LOCKED_AGENTS_ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        await setCustomAgentsAccess("free");
        expect(customAgentsGate.getCustomAgentsGate()).toBe("locked");

        expect(chats.ask(coco, "Maya", "Review.")).toEqual({ kind: "unavailable" });
      });

      it(`stops each asked agent's chat when the chat that asked closes for good (${ISSUE})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        await coco.dispose();

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.closeSession).toHaveBeenCalledWith({ sessionId: sessionIdOf(maya) });
      });

      it(`lets an asked agent finish and relays its reply when custom agents lock while it works, since the license is checked only when an @ is sent (${LOCKED_AGENTS_ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        await setCustomAgentsAccess("free");
        expect(customAgentsGate.getCustomAgentsGate()).toBe("locked");
        answer(maya, "Too many features.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "finished" }));
        expect(fake.promptsTo(sessionIdOf(coco))[1]).toContain("Too many features.");
      });

      it(`saves the run as working with its hidden chat, then finished (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        const [working] = mentionsOn(coco) ?? [];
        expect(working).toMatchObject({
          agent: "maya",
          name: "Maya",
          status: "working",
          chat: { backendId: "fake", sessionId: sessionIdOf(maya) },
        });

        answer(maya, "Too many features.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        const [finished] = mentionsOn(coco) ?? [];
        expect(finished).toMatchObject({ id: working.id, status: "finished" });
      });

      it(`saves that the agent didn't finish when its chat disconnects (${ISSUE})`, async () => {
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
          })
        );
      });

      it(`leaves the run working when the chat that asked closes, which its note then reads as didn't finish (${ISSUE})`, async () => {
        const { coco, maya } = await askFromMessage();

        await coco.dispose();
        await untilStatus(maya, (status) => status === "closed");

        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "working" }));
      });
    });

    describe("answerPermission()", () => {
      it(`shows an asked agent's request in the chat that asked, as from that agent with its face, and leaves other chats' requests alone (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        fake.endTurn(sessionIdOf(coco));

        void chats.answerPermission(requestFrom(maya));

        expect(coco.getPendingToolPermissions()).toEqual([
          {
            ...requestFrom(maya),
            requester: {
              agent: { slug: "maya", name: "Maya", faceSrc: agentNamed("Maya")!.faceSrc },
            },
          },
        ]);
        expect(chats.answerPermission({ ...requestFrom(maya), sessionId: sessionIdOf(coco) })).toBe(
          null
        );
      });

      it(`passes the user's answer back to the asked agent, and the asking agent runs no turn for it (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        fake.endTurn(sessionIdOf(coco));
        const decision = chats.answerPermission(requestFrom(maya));

        coco.resolveToolPermission("tc-write", "allow_once");

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
        expect(coco.getPendingToolPermissions()).toHaveLength(0);
        answer(maya, "Added.");
        expect(await fake.untilPrompt(sessionIdOf(coco), 2)).not.toContain("turned down");
      });

      it(`passes an "always" answer to an OpenCode-shaped request back as the agent's own option, so the agent saves the same rule its own card saves, and withdraws as the agent's own reject (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const openCodeRequest = (toolCallId: string): PermissionPrompt => ({
          sessionId: sessionIdOf(maya),
          toolCall: {
            toolCallId,
            title: "Plans/Launch plan.md",
            kind: "edit",
            status: "pending",
            locations: [{ path: "/vault/Plans/Launch plan.md" }],
          },
          options: [
            { optionId: "once", name: "Allow once", kind: "allow_once" },
            { optionId: "always", name: "Always allow", kind: "allow_always" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        const always = chats.answerPermission(openCodeRequest("oc-1"));
        coco.resolveToolPermission("oc-1", "always");
        await expect(always).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "always" },
        });

        const withdrawn = chats.answerPermission(openCodeRequest("oc-2"));
        chats.stop(coco, "Maya");

        await expect(withdrawn).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject" },
        });
      });

      it(`saves the run as waiting for the user's OK until every request is answered, then as working (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const first = chats.answerPermission(requestFrom(maya, "tc-first"));
        const second = chats.answerPermission(requestFrom(maya, "tc-second"));
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "permission" }));

        coco.resolveToolPermission("tc-first", "allow_once");
        await first;
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "permission" }));
        coco.resolveToolPermission("tc-second", "allow_once");
        await second;

        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "working" }));
      });

      it(`passes a rejection back to the asked agent, whose reply is relayed as a finished run (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const decision = chats.answerPermission(requestFrom(maya));
        coco.resolveToolPermission("tc-write", "reject_once");
        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });

        answer(maya, "You said no, so the plan is unchanged.");
        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayed).toContain("Maya replied. Pass the reply on to the user now.");
        expect(relayed).toContain("The user turned down a request from Maya");
        expect(relayed).toContain("You said no, so the plan is unchanged.");
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "finished" }));
      });

      it(`still says the user turned a request down in the final relay when the agent then asked a question and got its answer (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const decision = chats.answerPermission(requestFrom(maya));
        coco.resolveToolPermission("tc-write", "reject_once");
        await decision;
        chats.askUser(maya, "Which month, then?");
        fake.endTurn(sessionIdOf(maya));
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);
        fake.endTurn(sessionIdOf(coco));

        chats.answer(coco, "Maya", "October.");
        await fake.untilPrompt(sessionIdOf(maya), 2);
        answer(maya, "October left as it was.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayed).toContain("Maya replied.");
        expect(relayed).toContain("The user turned down a request from Maya");
      });

      it(`turns a request down, saying the chat that asked is in Plan mode, and shows no card while it is (${PERMISSION}, ${ENTRIES})`, async () => {
        const coco = await openChat({ agentSlug: "coco", backend: createFakeAgentBackend(PLAN) });
        const maya = await askedAndPrompted(coco);

        await expect(chats.answerPermission(requestFrom(maya))).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
          denyMessage:
            "Copilot turned this down: the chat that asked you is in Plan mode, so nothing can be changed. Don't try again. Say in your reply what you would have changed.",
        });
        expect(coco.getPendingToolPermissions()).toHaveLength(0);
      });

      it(`turns a request down without a card, saying the agent's work for the chat that asked has ended, when it comes after the agent's run ended, as right after a stop (${PERMISSION}, ${ENTRIES})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));

        await expect(chats.answerPermission(requestFrom(maya))).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
          denyMessage:
            "Copilot turned this down: your work for the chat that asked you has ended. Don't try again.",
        });
        expect(coco.getPendingToolPermissions()).toHaveLength(0);
      });

      it(`withdraws a waiting card as rejected when the asked agent's chat closes before it is answered (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const decision = chats.answerPermission(requestFrom(maya));

        await maya.dispose();

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(coco.getPendingToolPermissions()).toHaveLength(0);
      });

      it(`answers a waiting request as rejected when the chat that asked closes, so the asked agent never waits forever (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const decision = chats.answerPermission(requestFrom(maya));

        await coco.dispose();

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
      });
    });

    describe("askUser()", () => {
      it(`tells the asked agent it can ask the user with ask_user and then end its turn (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        const maya = await askedAndPrompted(coco);

        expect(fake.promptsTo(sessionIdOf(maya))[0]).toContain(
          "If you can't go on without the user's answer to a question, ask it with the ask_user tool from obsidian-copilot, then end your turn; the answer comes back as your next message."
        );
      });

      it(`relays the asked agent's question when its turn ends, saves the run as waiting on a question, and keeps it running (${CONTROL})`, async () => {
        const { coco, maya } = await askFromMessage();

        expect(chats.askUser(maya, "October or November?")).toBe("asked");
        fake.say(sessionIdOf(maya), "I need one call from the user.");
        fake.endTurn(sessionIdOf(maya));
        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayed).toContain(
          "Maya has a question for the user, quoted below, and waits for the answer. Ask the user in your own words, then end your turn. When the user answers, pass the answer to Maya with answer_teammate."
        );
        expect(relayed).toContain(
          '<teammate-reply from="Maya">\nOctober or November?\n</teammate-reply>'
        );
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "question" }));
        expect(chats.workingIn("maya")).toBe("Coco");
        const progress = chats.check(coco, "Maya");
        expect(progress.kind === "progress" && progress.progress).toContain(
          "Maya is waiting for the user to answer this question:\nOctober or November?"
        );
      });

      it(`turns down a question from a chat the user sees, which can ask the user itself (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });

        expect(chats.askUser(coco, "October?")).toBe("not_from_here");
        expect(chats.askUser(null, "October?")).toBe("not_from_here");
      });

      it(`ends a run waiting on a question as didn't finish when the asked agent's chat closes, as when its process dies (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();

        await maya.dispose();

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayed).toContain("Maya didn't finish (Maya's chat stopped before it finished.).");
        expect(mentionsOn(coco)?.[0]).toEqual(
          expect.objectContaining({
            status: "didnt_finish",
          })
        );
        expect(chats.workingIn("maya")).toBeNull();
      });

      it(`stops a run waiting on a question when the user stops it instead of answering, relaying what the agent wrote before it asked (${CONTROL})`, async () => {
        const { coco } = await waitingOnQuestion();

        expect(chats.stop(coco, "Maya")).toEqual(expect.objectContaining({ kind: "stopped" }));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayed).toContain("Maya stopped, as the user asked.");
        expect(relayed).toContain("Waiting for the user.");
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "stopped" }));
      });
      it(`leaves an agent waiting on the user's answer out of who is still working when another agent's reply is passed on (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();
        chats.askUser(leo, "October or November?");
        answer(leo, "Need one call.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);
        fake.endTurn(sessionIdOf(coco));

        answer(maya, "$8k is fine.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayed).toContain("$8k is fine.");
        expect(relayed).not.toContain("still working");
      });

      it(`relays each of two agents' questions under its own run and passes each answer only to the agent it names (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();
        chats.askUser(maya, "Count the video shoot?");
        chats.askUser(leo, "October or November?");
        answer(maya, "One question first.");
        answer(leo, "Need one call.");
        fake.endTurn(sessionIdOf(coco));
        const questions = [
          await fake.untilPrompt(sessionIdOf(coco), 2),
          await (async () => {
            fake.endTurn(sessionIdOf(coco));
            return fake.untilPrompt(sessionIdOf(coco), 3);
          })(),
        ];
        fake.endTurn(sessionIdOf(coco));
        const runs = mentionsOn(coco)!;
        expect(runs.map(({ status }) => status)).toEqual(["question", "question"]);
        const byAgent = Object.fromEntries(
          questions.map((relay) => [relayedFrom(relay), relay] as const)
        );
        expect(byAgent.maya).toContain(`"mention":"${runs[0].id}"`);
        expect(byAgent.maya).toContain("Count the video shoot?");
        expect(byAgent.leo).toContain(`"mention":"${runs[1].id}"`);
        expect(byAgent.leo).toContain("October or November?");

        expect(chats.answer(coco, "Leo", "October.")).toMatchObject({ kind: "answered" });

        expect(await fake.untilPrompt(sessionIdOf(leo), 2)).toContain("October.");
        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
        expect(mentionsOn(coco)?.map(({ status }) => status)).toEqual(["question", "working"]);
      });

      it(`relays a second question from the same run after the first was answered, and holds it open for its own answer (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();
        chats.answer(coco, "Maya", "October.");
        await fake.untilPrompt(sessionIdOf(maya), 2);

        chats.askUser(maya, "Which year?");
        answer(maya, "One more thing.");

        expect(await fake.untilPrompt(sessionIdOf(coco), 3)).toContain(
          '<teammate-reply from="Maya">\nWhich year?\n</teammate-reply>'
        );
        fake.endTurn(sessionIdOf(coco));
        expect(mentionsOn(coco)?.[0].status).toBe("question");
        expect(chats.ask(coco, "Maya", "Which year?")).toMatchObject({
          kind: "awaiting_answer",
          question: "Which year?",
        });
        chats.answer(coco, "Maya", "2026.");
        expect(await fake.untilPrompt(sessionIdOf(maya), 3)).toContain("2026.");
        answer(maya, "Added it to October 2026.");
        expect(await fake.untilPrompt(sessionIdOf(coco), 4)).toContain("Added it to October 2026.");
      });
    });

    describe("answer()", () => {
      it(`passes the user's answer into the same chat, saves the run as working again, and relays only what the agent wrote after the answer when it is done (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();

        expect(chats.answer(coco, "Maya", "October. They're October sales.")).toEqual({
          kind: "answered",
          agent: agentNamed("Maya"),
        });

        const passed = await fake.untilPrompt(sessionIdOf(maya), 2);
        expect(passed).toContain("Coco passed on the user's answer to your question.");
        expect(passed).toContain("October. They're October sales.");
        expect(mentionsOn(coco)?.[0].status).toBe("working");
        answer(maya, "All matched.");

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect(relayed).toContain("Maya replied.");
        expect(relayed).toContain("All matched.");
        expect(relayed).not.toContain("Waiting for the user.");
        expect(mentionsOn(coco)?.[0].status).toBe("finished");
        expect(startChat).toHaveBeenCalledTimes(1);
      });

      it(`records only what the agent wrote after the user's answer as its latest answer, and the run as finished (${RECALL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();

        chats.answer(coco, "Maya", "October.");
        await fake.untilPrompt(sessionIdOf(maya), 2);
        answer(maya, "All matched.");
        await fake.untilPrompt(sessionIdOf(coco), 3);

        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({ asks: 1, latestAnswer: "All matched.", ending: "finished" }),
        ]);
      });

      it(`relays that the agent didn't finish when its chat refuses the answer, as when its model's usage limit is reached (${CONTROL})`, async () => {
        const { coco } = await waitingOnQuestion();
        jest
          .spyOn(fake.backend, "prompt")
          .mockRejectedValueOnce(new Error("Free usage limit reached"));

        chats.answer(coco, "Maya", "October.");

        expect(await fake.untilPrompt(sessionIdOf(coco), 3)).toContain(
          "Maya didn't finish (Free usage limit reached)."
        );
        expect(mentionsOn(coco)?.[0]).toMatchObject({
          status: "didnt_finish",
        });
      });

      it(`passes nothing and says no question waits when the agent isn't waiting on one, including from a chat with no chat open with it, as after a restart (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const other = await openChat();
        const maya = await askedAndPrompted(coco);

        expect(chats.answer(coco, "Maya", "October.")).toEqual({
          kind: "no_question",
          agent: agentNamed("Maya"),
        });
        expect(chats.answer(other, "Maya", "October.")).toEqual({
          kind: "no_question",
          agent: agentNamed("Maya"),
        });
        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
      });
    });

    describe("check()", () => {
      it(`reports how long the agent has worked, the end of what it has written and its latest steps, without sending it anything (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco, "Reconcile October.");
        fake.say(sessionIdOf(maya), "Matched 182 of 214 transactions.");
        fake.emit(sessionIdOf(maya), {
          sessionUpdate: "tool_call",
          toolCallId: "read-1",
          title: "Read Finance/October books.md",
          status: "completed",
        });

        const result = chats.check(coco, "Maya");

        expect(result).toMatchObject({ kind: "progress", agent: agentNamed("Maya") });
        const progress = result.kind === "progress" ? result.progress : "";
        expect(progress).toContain("Maya has been working for under a minute.");
        expect(progress).toContain("Matched 182 of 214 transactions.");
        expect(progress).toContain("- Read Finance/October books.md (completed)");
        expect(fake.promptsTo(sessionIdOf(maya))).toHaveLength(1);
      });

      it(`keeps the progress short: only the end of a long reply, the latest steps and the start of each step's title, such as a long shell command (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        fake.say(sessionIdOf(maya), `START ${"x".repeat(5000)} END`);
        for (let step = 1; step <= 15; step++) {
          fake.emit(sessionIdOf(maya), {
            sessionUpdate: "tool_call",
            toolCallId: `step-${step}`,
            title:
              step === 15 ? `Step 15 python3 - <<'PY'\n${"y".repeat(5000)}\nPY` : `Step ${step}`,
            status: "completed",
          });
        }

        const result = chats.check(coco, "Maya");

        const progress = result.kind === "progress" ? result.progress : "";
        expect(progress).toContain("END");
        expect(progress).not.toContain("START");
        expect(progress).toContain("- Step 14 (completed)");
        expect(progress).toContain("- Step 15 python3");
        expect(progress).not.toContain("- Step 5 (completed)");
        expect(progress.length).toBeLessThan(2500);
      });

      it(`says the agent is waiting for the user's OK while its request waits in the chat (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        void chats.answerPermission(requestFrom(maya));

        const result = chats.check(coco, "Maya");

        expect(result.kind === "progress" ? result.progress : "").toContain(
          "Maya is waiting for the user's OK on a permission card in this chat."
        );
      });

      it(`answers that the agent has no run from this chat, with no progress to report, once it finished, as when the chat never asked it (${CONTROL}, ${ENTRIES})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const other = await openChat();
        const maya = await askedAndPrompted(coco);
        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));

        expect(chats.check(coco, "Maya")).toEqual({
          kind: "not_asked",
          agent: agentNamed("Maya"),
        });
        expect(chats.check(other, "Maya")).toEqual({
          kind: "not_asked",
          agent: agentNamed("Maya"),
        });
      });

      it(`turns down a check from a chat no list shows, such as an asked agent's own chat (${CONTROL})`, async () => {
        const hidden = await openChat({ agentSlug: "maya", listed: false });

        expect(chats.check(hidden, "Coco")).toEqual({ kind: "not_from_here" });
      });
    });

    describe("stop()", () => {
      it(`stops the asked agent's turn, saves the run as stopped by the user, and relays how far it got with the files it changed (${CONTROL})`, async () => {
        const { coco, maya } = await askFromMessage();
        fake.say(sessionIdOf(maya), "Matched 120 of 214 so far.");
        maya.store.setFileChanges(maya.store.getDisplayMessages().at(-1)!.id, [PLAN_CHANGE]);

        expect(chats.stop(coco, "Maya")).toEqual({ kind: "stopped", agent: agentNamed("Maya") });
        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(fake.cancel).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: sessionIdOf(maya) })
        );
        expect(relayed).toContain(
          "Maya stopped, as the user asked. Maya's changes stay. Tell the user how far Maya got and what Maya changed"
        );
        expect(relayed).toContain('<teammate-reply from="Maya">\nMatched 120 of 214 so far.\n');
        expect(relayed).toContain("Maya changed Plans/Launch plan.md.");
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.fileChanges).toEqual([PLAN_CHANGE]);
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "stopped" }));
        expect(markerOf(relayed)).toMatchObject({ status: "stopped" });
      });

      it(`records a stopped run as stopped with what the agent had written, whether stopped by its agent or from the list (${RECALL})`, async () => {
        const { coco, maya } = await askFromMessage();
        fake.say(sessionIdOf(maya), "Matched 120 of 214 so far.");

        chats.stop(coco, "Maya", { fromList: true });
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        expect(await index.getAskedConversations()).toEqual([
          expect.objectContaining({
            latestAnswer: "Matched 120 of 214 so far.",
            ending: "stopped",
          }),
        ]);
      });

      it(`relays the files a stopped turn changed, though they are recorded after its chat goes idle (${CONTROL})`, async () => {
        const adapter = new FileSystemAdapter();
        const laterReads: Array<() => void> = [];
        adapter.read = jest
          .fn()
          .mockResolvedValueOnce(PLAN_CHANGE.before)
          .mockImplementation(
            () =>
              new Promise<string>((resolve) => laterReads.push(() => resolve(PLAN_CHANGE.after)))
          );
        startChat.mockImplementationOnce(async (start) => {
          const session = AgentSession.start({
            backend: fake.backend,
            cwd: "/vault",
            internalId: "hidden-files",
            backendId: "fake",
            agent: start.prompt,
            observeSessionEvent: start.observeSessionEvent,
            getApp: () => ({ vault: { adapter } }) as unknown as App,
          });
          await session.ready;
          started.push(session);
          startWaiters.forEach((wake) => wake());
          return session;
        });
        const { coco, maya } = await askFromMessage();
        fake.emit(sessionIdOf(maya), {
          sessionUpdate: "tool_call",
          toolCallId: "edit-1",
          title: "Edit",
          kind: "edit",
          status: "completed",
          locations: [{ path: `/vault/${PLAN_CHANGE.path}` }],
        });

        chats.stop(coco, "Maya");
        await untilStatus(maya, (status) => status === "idle");
        fake.endTurn(sessionIdOf(coco));
        laterReads.forEach((read) => read());

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayed).toContain(`Maya changed ${PLAN_CHANGE.path}.`);
        const relayMessage = coco.store.getDisplayMessages().find((m) => m.message === relayed);
        expect(relayMessage?.fileChanges).toEqual([
          expect.objectContaining({ path: PLAN_CHANGE.path, additions: 1 }),
        ]);
      });

      it(`keeps the stopped agent's chat, so asking it again continues the same conversation (${CONTROL})`, async () => {
        const { coco, maya } = await askFromMessage();
        chats.stop(coco, "Maya");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);

        expect(chats.ask(coco, "Maya", "Pick up where you stopped.")).toEqual(
          expect.objectContaining({ kind: "asked" })
        );

        expect(await fake.untilPrompt(sessionIdOf(maya), 2)).toContain(
          "Pick up where you stopped."
        );
        expect(startChat).toHaveBeenCalledTimes(1);
        expect(maya.getStatus()).not.toBe("closed");
      });

      it(`withdraws the agent's waiting card at once, answering its request as rejected, since the agent ends its turn only once answered, and the stop's relay does not say the user turned it down (${PERMISSION})`, async () => {
        const { coco, maya } = await askFromMessage();
        const decision = chats.answerPermission(requestFrom(maya));
        fake.cancel.mockImplementationOnce(async () => undefined);

        chats.stop(coco, "Maya");

        expect(coco.getPendingToolPermissions()).toHaveLength(0);
        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(coco.getPendingToolPermissions()).toHaveLength(0);
        fake.endTurn(sessionIdOf(maya));
        fake.endTurn(sessionIdOf(coco));
        expect(await fake.untilPrompt(sessionIdOf(coco), 2)).not.toContain("turned down");
      });

      it(`tells the chat's agent the user stopped the agent from the list above the chat input, and saves it as stopped by the user (${RUNNING})`, async () => {
        const { coco } = await askFromMessage();

        expect(chats.stop(coco, "maya", { fromList: true })).toEqual(
          expect.objectContaining({ kind: "stopped" })
        );
        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayed).toContain(
          "Maya stopped. The user already knows, so don't mention the stop; go straight to how far Maya got."
        );
        expect(relayed).not.toContain("as the user asked");
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "stopped" }));
      });

      it(`stops the run with the agent's slug, as the chat's running agents list does (${CONTROL})`, async () => {
        const { coco } = await askFromMessage();

        expect(chats.stop(coco, "maya")).toEqual(expect.objectContaining({ kind: "stopped" }));
      });

      it(`stops nothing and says so when the agent isn't working for that chat (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");

        expect(chats.stop(coco, "Maya")).toEqual({
          kind: "not_working",
          agent: agentNamed("Maya"),
        });
        expect(fake.cancel).not.toHaveBeenCalled();
      });

      it(`turns down stopping an agent the chat never asked, and stopping from a chat no list shows (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const other = await openChat();
        await askedAndPrompted(coco);
        const hidden = await openChat({ agentSlug: "maya", listed: false });

        expect(chats.stop(other, "Maya")).toEqual({ kind: "not_asked", agent: agentNamed("Maya") });
        expect(chats.stop(hidden, "Maya")).toEqual({ kind: "not_from_here" });
        expect(fake.cancel).not.toHaveBeenCalled();
      });

      it(`sends nothing, not even a message sent on while its chat started, to an agent stopped before its chat started (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        let finishStart: () => void = () => {};
        const startCalled = new Promise<void>((called) =>
          startChat.mockImplementationOnce(async (start) => {
            await new Promise<void>((resolve) => {
              finishStart = resolve;
              called();
            });
            return startLate(start);
          })
        );
        const startLate = async (start: HiddenChatStart) => {
          const session = AgentSession.start({
            backend: fake.backend,
            cwd: "/vault",
            internalId: "hidden-late",
            backendId: "fake",
            agent: start.prompt,
            observeSessionEvent: start.observeSessionEvent,
          });
          await session.ready;
          started.push(session);
          return session;
        };
        chats.ask(coco, "Maya", "Review the plan.");
        await startCalled;
        chats.ask(coco, "Maya", "Only the budget part.");

        chats.stop(coco, "Maya");
        finishStart();

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain(
          "Maya stopped, as the user asked."
        );
        expect(started[0].store.getDisplayMessages()).toEqual([]);
        expect(fake.promptsTo(sessionIdOf(started[0]))).toEqual([]);
      });
      it(`stops one of two agents one message asked and leaves the other working (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();

        expect(chats.stop(coco, "Leo")).toMatchObject({ kind: "stopped" });
        fake.endTurn(sessionIdOf(coco));

        expect(relayedFrom(await fake.untilPrompt(sessionIdOf(coco), 2))).toBe("leo");
        expect(fake.cancel).not.toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: sessionIdOf(maya) })
        );
        expect(mentionsOn(coco)?.map(({ status }) => status)).toEqual(["working", "stopped"]);
        fake.endTurn(sessionIdOf(coco));
        answer(maya, "$8k is fine.");
        expect(await fake.untilPrompt(sessionIdOf(coco), 3)).toContain("$8k is fine.");
        expect(leo.getStatus()).not.toBe("closed");
      });

      it(`names neither agent as still working when the user stops both at once (${SEVERAL})`, async () => {
        const { coco } = await askBoth();

        chats.stop(coco, "Leo");
        chats.stop(coco, "Maya");
        fake.endTurn(sessionIdOf(coco));

        const first = await fake.untilPrompt(sessionIdOf(coco), 2);
        fake.endTurn(sessionIdOf(coco));
        const second = await fake.untilPrompt(sessionIdOf(coco), 3);
        expect([first, second].map(relayedFrom).sort()).toEqual(["leo", "maya"]);
        expect(first).not.toContain("still working");
        expect(second).not.toContain("still working");
      });
    });

    describe("stopAgent()", () => {
      it(`stops a deleted agent's run, saves it as stopped because the agent was deleted, relays how far it got, and closes its chat (${CONTROL})`, async () => {
        const { coco, maya } = await askFromMessage();
        fake.say(sessionIdOf(maya), "Halfway through.");

        chats.stopAgent("maya");
        fake.endTurn(sessionIdOf(coco));

        const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(relayed).toContain(
          "Maya stopped because the user deleted Maya. Maya's changes stay. Tell the user how far Maya got and what Maya changed"
        );
        expect(relayed).toContain("Halfway through.");
        expect(mentionsOn(coco)?.[0]).toEqual(expect.objectContaining({ status: "stopped" }));
        await untilStatus(maya, (status) => status === "closed");
        expect(fake.closeSession).toHaveBeenCalledWith({ sessionId: sessionIdOf(maya) });
      });

      it(`closes a deleted agent's idle chat without relaying anything (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);
        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));
        fake.endTurn(sessionIdOf(coco));
        await untilStatus(maya, (status) => status === "idle");

        chats.stopAgent("maya");

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(1);
      });

      it(`forgets the conversations the deleted agent was asked into, even one it was working in, and keeps those it asked, so a new agent with its name starts with none (${RECALL})`, async () => {
        const { coco, maya } = await askFromMessage();
        await index.updateAskedConversation("fake", "leo-hidden", () => ({
          backendId: "fake",
          sessionId: "leo-hidden",
          agent: "leo",
          askedBy: "maya",
          askedIn: { backendId: "fake", sessionId: "maya-chat" },
          firstAtMs: 1,
          lastAtMs: 1,
          asks: 1,
          firstAsk: "Check the budget.",
        }));

        chats.stopAgent("maya");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);
        await untilStatus(maya, (status) => status === "closed");

        expect((await index.getAskedConversations()).map(({ agent }) => agent)).toEqual(["leo"]);
      });

      it(`records nothing for an agent deleted while its chat was starting, since it never got the ask, so a new agent with its name starts with none (${RECALL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        let finishStart: () => void = () => {};
        const startCalled = new Promise<void>((called) =>
          startChat.mockImplementationOnce(async (start) => {
            await new Promise<void>((resolve) => {
              finishStart = resolve;
              called();
            });
            const session = AgentSession.start({
              backend: fake.backend,
              cwd: "/vault",
              internalId: "hidden-late",
              backendId: "fake",
              agent: start.prompt,
              observeSessionEvent: start.observeSessionEvent,
            });
            await session.ready;
            started.push(session);
            return session;
          })
        );
        chats.ask(coco, "Maya", "Review the plan.");
        await startCalled;

        chats.stopAgent("maya");
        finishStart();

        expect(await fake.untilPrompt(sessionIdOf(coco))).toContain("the user deleted Maya");
        expect(fake.promptsTo(sessionIdOf(started[0]))).toEqual([]);
        expect(await index.getAskedConversations()).toEqual([]);
      });

      it(`leaves other agents' chats running (${CONTROL})`, async () => {
        const { coco, maya } = await askFromMessage();

        chats.stopAgent("coco");

        expect(fake.cancel).not.toHaveBeenCalled();
        expect(maya.getStatus()).not.toBe("closed");
        expect(mentionsOn(coco)?.[0].status).toBe("working");
      });
      it(`stops a deleted agent while another agent the same message asked keeps working (${SEVERAL})`, async () => {
        const { coco, maya, leo } = await askBoth();

        chats.stopAgent("leo");
        fake.endTurn(sessionIdOf(coco));

        expect(relayedFrom(await fake.untilPrompt(sessionIdOf(coco), 2))).toBe("leo");
        await untilStatus(leo, (status) => status === "closed");
        expect(maya.getStatus()).not.toBe("closed");
        expect(mentionsOn(coco)?.map(({ status }) => status)).toEqual(["working", "stopped"]);
        fake.endTurn(sessionIdOf(coco));
        answer(maya, "$8k is fine.");
        expect(await fake.untilPrompt(sessionIdOf(coco), 3)).toContain("$8k is fine.");
      });
    });

    describe("workingIn()", () => {
      it(`names the agent whose chat an agent works in, and nothing once it is done (${CONTROL})`, async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        expect(chats.workingIn("maya")).toBe("Coco");
        expect(chats.workingIn("coco")).toBeNull();

        answer(maya, "Done.");
        await fake.untilPrompt(sessionIdOf(coco));
        expect(chats.workingIn("maya")).toBeNull();
      });
    });

    describe("askedChat()", () => {
      it(`gives a run's chat with the message that started each run and when, so a later run reads as continued (${RUNNING})`, async () => {
        const { coco, maya } = await askFromMessage();
        answer(maya, "Done.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);
        fake.endTurn(sessionIdOf(coco));
        coco.sendPrompt("@Maya and the intro?");
        await fake.untilPrompt(sessionIdOf(coco), 3);
        chats.ask(coco, "Maya", "And the intro?");
        await fake.untilPrompt(sessionIdOf(maya), 2);

        const [first, second] = coco.store
          .getDisplayMessages()
          .flatMap((message) => message.agentMentions ?? []);
        const chat = chats.askedChat(coco, first);
        const jobs = maya.store.getDisplayMessages().filter((m) => m.message.includes("<message"));

        expect(chat?.session).toBe(maya);
        expect(chats.askedChat(coco, second)?.session).toBe(maya);
        expect(Array.from(chat!.continuedAt)).toEqual([
          [jobs[0].id, first.startedAt],
          [jobs[1].id, second.startedAt],
        ]);
      });

      it(`gives nothing for a run whose chat is no longer open, as after a restart, or never opened, as when the agent couldn't start (${RUNNING})`, async () => {
        const { coco } = await askFromMessage();
        const [run] = mentionsOn(coco)!;

        expect(
          chats.askedChat(coco, { ...run, chat: { backendId: "fake", sessionId: "from-before" } })
        ).toBeNull();
        expect(chats.askedChat(coco, { ...run, chat: undefined })).toBeNull();
        expect(chats.askedChat(coco, { ...run, agent: "coco" })).toBeNull();
      });
    });

    describe("askedChatOf()", () => {
      it("gives an asked agent's chat with the chat that asked it, and nothing for a chat no agent was asked into", async () => {
        const coco = await openChat({ agentSlug: "coco" });
        const maya = await askedAndPrompted(coco);

        expect(chats.askedChatOf(maya)).toEqual({ session: maya, askedFrom: coco });
        expect(chats.askedChatOf(coco)).toBeNull();
        expect(chats.askedChatOf(null)).toBeNull();
      });
    });

    describe("workingOn()", () => {
      it(`gives what a saved run's agent was asked while it still works on it for the chat that asked, nothing for another chat holding the same run, and nothing once it is done (${RUNNING})`, async () => {
        const { coco, maya } = await askFromMessage();
        const continued = await openChat({ agentSlug: "coco" });
        const runId = mentionsOn(coco)![0].id;

        expect(chats.workingOn(coco, runId)).toBe("What do you think of this plan?");
        expect(chats.workingOn(coco, "another-run")).toBeNull();
        expect(chats.workingOn(continued, runId)).toBeNull();

        answer(maya, "Done.");
        fake.endTurn(sessionIdOf(coco));
        await fake.untilPrompt(sessionIdOf(coco), 2);
        expect(chats.workingOn(coco, runId)).toBeNull();
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

      it(`passes an open question on only once, not again on unload (${CONTROL})`, async () => {
        const { coco, maya } = await waitingOnQuestion();

        chats.dispose();

        await untilStatus(maya, (status) => status === "closed");
        expect(fake.promptsTo(sessionIdOf(coco))).toHaveLength(2);
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

  describe("readAskedMessage()", () => {
    it(`reads what the asking agent sent and whether it passed on the user's answer (${RUNNING})`, async () => {
      const { coco, maya } = await waitingOnQuestion();
      chats.answer(coco, "Maya", "October.");
      await fake.untilPrompt(sessionIdOf(maya), 2);

      const [asked, passed] = maya.store
        .getDisplayMessages()
        .filter((message) => message.message.includes("from="))
        .map((message) => readAskedMessage(message.message));

      expect(asked).toEqual({ answer: false, text: "What do you think of this plan?" });
      expect(passed).toEqual({ answer: true, text: "October." });
    });

    it(`reads nothing from text the asking agent didn't send (${RUNNING})`, () => {
      expect(readAskedMessage("Hello there.")).toBeNull();
    });
  });
});
