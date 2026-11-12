import type { AgentFileManager } from "@/agents/AgentFileManager";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { AGENT_MEMORY, holdMemoryNotice } from "@/agents/agentMode/agentMemoryChat";
import {
  AgentMemoryKeeper,
  MEMORY_PASS_SHUTDOWN_GRACE_MS,
  type AgentMemoryHost,
} from "@/agents/agentMode/AgentMemoryKeeper";
import {
  AGENT_MEMORY_CONSOLIDATION_IDLE_MS,
  AGENT_MEMORY_FLUSH_IDLE_MS,
} from "@/agents/agentMode/agentMemoryScheduler";
import type { CustomAgent } from "@/agents/types";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { FanoutTurnRequest } from "@/agentMode/session/fanout/FanoutOrchestrator";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";
import type { SessionAgent } from "@/agentMode/session/sessionAgent";
import { fakeChat, fakeChatView } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { patchFrontmatter } from "@/utils/vaultAdapterUtils";
import {
  runAgentMemoryFlush,
  type AgentMemoryFlushOutcome,
} from "@/agents/agentMode/agentMemoryPass";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { activeBackend: "claude" } }),
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  patchFrontmatter: jest.fn(async () => undefined),
}));
jest.mock("@/agents/agentMode/agentMemoryPass", () => ({
  ...jest.requireActual<object>("@/agents/agentMode/agentMemoryPass"),
  runAgentMemoryFlush: jest.fn(),
}));
jest.mock("@/agents/agentMode/agentMemoryConsolidation", () => ({
  runAgentMemoryConsolidation: jest.fn(),
  hasUnconsolidatedNotes: jest.fn(),
}));

const mockFlush = jest.mocked(runAgentMemoryFlush);
const mockConsolidate = jest.requireMock("@/agents/agentMode/agentMemoryConsolidation")
  .runAgentMemoryConsolidation as jest.Mock;
const mockHasUnconsolidatedNotes = jest.requireMock("@/agents/agentMode/agentMemoryConsolidation")
  .hasUnconsolidatedNotes as jest.Mock;

const APP = { name: "vault" } as unknown as App;

const JENNIFER_CHAT: SessionAgent = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  personaBlock: null,
};

const COPILOT_CHAT: SessionAgent = { slug: null, name: "Copilot", icon: "", personaBlock: null };

const WROTE: AgentMemoryFlushOutcome = {
  status: "written",
  agentName: "Jennifer",
  notePath: "copilot/agents/jennifer/memory/2026-09-17.md",
  date: "2026-09-17",
};

const CONSOLIDATED = {
  status: "written",
  agentName: "Jennifer",
  memoryPath: "copilot/agents/jennifer/MEMORY.md",
  consolidatedThrough: "2026-09-17",
};

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const ONE_TURN = [message("u1", USER_SENDER), message("a1", AI_SENDER)];

function jennifer(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor.",
    icon: "🪶",
    backendId: null,
    modelId: null,
    effort: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "You are Jennifer.",
    ...overrides,
  };
}

interface ChatOptions {
  agent?: SessionAgent;
  messages?: AgentChatMessage[];
  label?: string | null;
}

function buildKeeper(agents: CustomAgent[] = [jennifer()]) {
  const chats = new Map<string, AgentSession>();
  const sourcePaths = new Map<string, string>();
  const files = {
    listAgents: jest.fn(async () => agents.map((agent) => ({ agent }))),
    readMemoryDocument: jest.fn(async () => null),
  };
  const host: AgentMemoryHost = {
    subSessions: {} as ReadOnlySubSessionRunner,
    getSession: (id) => chats.get(id) ?? null,
    getSessions: () => Array.from(chats.values()),
    getSessionSourcePath: (id) => sourcePaths.get(id) ?? "",
  };
  const keeper = new AgentMemoryKeeper(APP, host, files as unknown as AgentFileManager);

  function openChat(id: string, options: ChatOptions = {}) {
    let messages = options.messages ?? ONE_TURN;
    const view = fakeChatView([], options.agent ?? JENNIFER_CHAT);
    const chat = Object.assign(fakeChat({ ...view, getDisplayMessages: () => messages }), {
      internalId: id,
      backendId: "claude",
      getAgent: view.getAgent,
      getDisplayMessages: () => messages,
      getLabel: () => options.label ?? null,
      getStatus: () => "idle",
    }) as unknown as AgentSession;
    chats.set(id, chat);
    return {
      chat,
      say: (next: AgentChatMessage[]) => {
        messages = next;
      },
      close: () => chats.delete(id),
      saveAt: (path: string) => sourcePaths.set(id, path),
    };
  }

  return { keeper, files, openChat };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useRealTimers();
  mockFlush.mockReset();
  mockFlush.mockResolvedValue({ status: "skipped", reason: "nothing-to-keep" });
  mockConsolidate.mockReset();
  mockConsolidate.mockResolvedValue({ status: "skipped", reason: "no-new-notes" });
  mockHasUnconsolidatedNotes.mockReset();
  mockHasUnconsolidatedNotes.mockResolvedValue(false);
  jest.mocked(patchFrontmatter).mockClear();
});

describe("AgentMemoryKeeper", () => {
  describe("AgentMemoryKeeper", () => {
    describe("onChatLeft()", () => {
      it("flushes the chat's turns into its agent's daily note, under the chat's title (designdocs/CUSTOM_AGENTS.md §5)", () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1", { label: "Newsletter rename" });

        keeper.onChatLeft(chat);

        expect(mockFlush).toHaveBeenCalledTimes(1);
        expect(mockFlush.mock.calls[0][1]).toMatchObject({
          agentSlug: "jennifer",
          sessionBackendId: "claude",
          messages: ONE_TURN,
          chatTitle: "Newsletter rename",
        });
      });

      it("never flushes a chat held with Copilot", () => {
        const { keeper, openChat } = buildKeeper();

        keeper.onChatLeft(openChat("chat-1", { agent: COPILOT_CHAT }).chat);

        expect(mockFlush).not.toHaveBeenCalled();
      });

      it("never flushes a chat with no turns", () => {
        const { keeper, openChat } = buildKeeper();

        keeper.onChatLeft(openChat("chat-1", { messages: [] }).chat);

        expect(mockFlush).not.toHaveBeenCalled();
      });
    });

    describe("updateNow()", () => {
      it("shows the trust line and advances the chat's marker once the note is written (designdocs/CUSTOM_AGENTS.md §5)", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        mockFlush.mockResolvedValue(WROTE);

        await keeper.updateNow("chat-1");

        expect(chat.readChatState(AGENT_MEMORY)).toMatchObject({
          memorizedThroughTurn: 2,
          notice: {
            kind: "flush",
            agentName: "Jennifer",
            path: "copilot/agents/jennifer/memory/2026-09-17.md",
            afterUserTurn: 1,
          },
        });
      });

      it("feeds only the turns said since the last flush, and nothing once none are new", async () => {
        const { keeper, openChat } = buildKeeper();
        const { say } = openChat("chat-1");
        await keeper.updateNow("chat-1");
        const later = [...ONE_TURN, message("u2", USER_SENDER), message("a2", AI_SENDER)];
        say(later);

        await keeper.updateNow("chat-1");

        expect(mockFlush.mock.calls[1][1].messages).toEqual(later.slice(2));
        expect(keeper.updateNow("chat-1")).toBeNull();
      });

      it("advances the marker but shows no line when nothing was worth keeping", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");

        await keeper.updateNow("chat-1");

        expect(chat.readChatState(AGENT_MEMORY)).toMatchObject({
          memorizedThroughTurn: 2,
          notice: null,
        });
      });

      it("leaves the marker alone when the pass failed, so the same turns are read again", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        mockFlush.mockResolvedValue({ status: "failed", error: "backend down" });

        await keeper.updateNow("chat-1");

        expect(chat.readChatState(AGENT_MEMORY)).toBe(AGENT_MEMORY.initial);
      });

      it("runs one pass per chat at a time, so a request during a pass starts nothing", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        const landing = deferred<AgentMemoryFlushOutcome>();
        mockFlush.mockReturnValue(landing.promise);

        const pass = keeper.updateNow("chat-1");
        keeper.onChatLeft(chat);

        expect(keeper.updateNow("chat-1")).toBeNull();
        expect(mockFlush).toHaveBeenCalledTimes(1);
        landing.resolve(WROTE);
        await pass;
      });

      it("records the marker on the saved chat note when the chat closed before the pass landed", async () => {
        const { keeper, openChat } = buildKeeper();
        const { close, saveAt } = openChat("chat-1");
        saveAt("chats/agent__newsletter.md");
        const landing = deferred<AgentMemoryFlushOutcome>();
        mockFlush.mockReturnValue(landing.promise);

        const pass = keeper.updateNow("chat-1");
        close();
        landing.resolve(WROTE);
        await pass;

        expect(patchFrontmatter).toHaveBeenCalledWith(APP, "chats/agent__newsletter.md", {
          memorizedThroughTurn: 2,
        });
      });

      it("starts nothing for a chat that is not open", () => {
        expect(buildKeeper().keeper.updateNow("gone")).toBeNull();
      });
    });

    describe("onTurnStarted()", () => {
      it("keeps a chat whose next turn started from being flushed as idle", () => {
        jest.useFakeTimers();
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        keeper.onTurnEnded(chat);

        keeper.onTurnStarted(chat);
        jest.advanceTimersByTime(AGENT_MEMORY_FLUSH_IDLE_MS);

        expect(mockFlush).not.toHaveBeenCalled();
      });
    });

    describe("onTurnEnded()", () => {
      it("flushes a chat that has sat idle since its turn ended (designdocs/CUSTOM_AGENTS.md §5)", () => {
        jest.useFakeTimers();
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");

        keeper.onTurnEnded(chat);
        expect(mockFlush).not.toHaveBeenCalled();
        jest.advanceTimersByTime(AGENT_MEMORY_FLUSH_IDLE_MS);

        expect(mockFlush).toHaveBeenCalledTimes(1);
      });

      it("consolidates every agent with unfolded notes once no chat has run for the idle window", async () => {
        jest.useFakeTimers();
        const { keeper, openChat } = buildKeeper([jennifer(), jennifer({ slug: "sage" })]);
        mockHasUnconsolidatedNotes.mockImplementation(async (_files, slug) => slug === "jennifer");

        keeper.onTurnEnded(openChat("chat-1").chat);
        await jest.advanceTimersByTimeAsync(AGENT_MEMORY_CONSOLIDATION_IDLE_MS);

        expect(mockConsolidate).toHaveBeenCalledTimes(1);
        expect(mockConsolidate.mock.calls[0][1]).toMatchObject({
          agentSlug: "jennifer",
          sessionBackendId: "claude",
        });
      });

      it("shows a consolidation line held for the chat once its turn ends", () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        chat.updateChatState(AGENT_MEMORY, (state) =>
          holdMemoryNotice(state, {
            kind: "consolidation",
            agentName: "Jennifer",
            path: "copilot/agents/jennifer/MEMORY.md",
          })
        );

        keeper.onTurnEnded(chat);

        expect(chat.readChatState(AGENT_MEMORY)).toMatchObject({
          heldNotice: null,
          notice: { kind: "consolidation", afterUserTurn: 1 },
        });
      });
    });

    describe("onFanoutTurn()", () => {
      const ASKED = {
        agentSlugs: ["jennifer", "sage"],
        sessionBackendId: "opencode",
        originalPromptText: "which title is better?",
      } as unknown as FanoutTurnRequest;

      function answered(sage: "done" | "error"): FanoutTurn {
        return {
          answers: {
            jennifer: {
              agentSlug: "jennifer",
              name: "Jennifer",
              icon: "",
              status: "done",
              text: "jennifer answered",
            },
            sage: {
              agentSlug: "sage",
              name: "Sage",
              icon: "",
              status: sage,
              text: sage === "done" ? "sage answered" : "",
            },
          },
          summary: { status: "done", text: "summary" },
        };
      }

      it("folds each answer into its own agent's memory, under a heading for passing questions", () => {
        const { keeper } = buildKeeper();

        keeper.onFanoutTurn(answered("done"), ASKED);

        expect(mockFlush.mock.calls.map(([, request]) => request.agentSlug)).toEqual([
          "jennifer",
          "sage",
        ]);
        expect(mockFlush.mock.calls[0][1]).toMatchObject({
          sessionBackendId: "opencode",
          chatTitle: "Asked in passing",
          messages: [
            expect.objectContaining({ sender: USER_SENDER, message: "which title is better?" }),
            expect.objectContaining({ sender: AI_SENDER, message: "jennifer answered" }),
          ],
        });
      });

      it("skips an agent that did not answer", () => {
        const { keeper } = buildKeeper();

        keeper.onFanoutTurn(answered("error"), ASKED);

        expect(mockFlush.mock.calls.map(([, request]) => request.agentSlug)).toEqual(["jennifer"]);
      });
    });

    describe("beforeShutdown()", () => {
      it("flushes every open chat with an agent and waits for the passes to land (designdocs/CUSTOM_AGENTS.md §5)", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        openChat("chat-2", { agent: COPILOT_CHAT });
        mockFlush.mockResolvedValue(WROTE);

        await keeper.beforeShutdown();

        expect(mockFlush).toHaveBeenCalledTimes(1);
        expect(chat.readChatState(AGENT_MEMORY).memorizedThroughTurn).toBe(2);
      });

      it("stops waiting for a pass that has not landed within the grace period", async () => {
        jest.useFakeTimers();
        const { keeper, openChat } = buildKeeper();
        openChat("chat-1");
        mockFlush.mockReturnValue(new Promise(() => undefined));

        const shutdown = keeper.beforeShutdown();
        await jest.advanceTimersByTimeAsync(MEMORY_PASS_SHUTDOWN_GRACE_MS);

        await expect(shutdown).resolves.toBeUndefined();
      });

      it("cancels the idle flush and consolidation, so nothing runs after unload", async () => {
        jest.useFakeTimers();
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1", { messages: [] });
        mockHasUnconsolidatedNotes.mockResolvedValue(true);
        keeper.onTurnEnded(chat);

        await keeper.beforeShutdown();
        await jest.advanceTimersByTimeAsync(AGENT_MEMORY_CONSOLIDATION_IDLE_MS);

        expect(mockFlush).not.toHaveBeenCalled();
        expect(mockConsolidate).not.toHaveBeenCalled();
      });
    });

    describe("consolidateNow()", () => {
      it("consolidates on the user's say-so without first checking for new notes", async () => {
        const { keeper } = buildKeeper();

        await keeper.consolidateNow("jennifer");

        expect(mockHasUnconsolidatedNotes).not.toHaveBeenCalled();
        expect(mockConsolidate.mock.calls[0][1]).toMatchObject({ agentSlug: "jennifer" });
      });

      it("holds the consolidation line for each open chat with the agent until its next turn ends", async () => {
        const { keeper, openChat } = buildKeeper();
        const { chat } = openChat("chat-1");
        const { chat: other } = openChat("chat-2", { agent: COPILOT_CHAT });
        mockConsolidate.mockResolvedValue(CONSOLIDATED);

        await keeper.consolidateNow("jennifer");

        expect(chat.readChatState(AGENT_MEMORY)).toMatchObject({
          notice: null,
          heldNotice: {
            kind: "consolidation",
            agentName: "Jennifer",
            path: "copilot/agents/jennifer/MEMORY.md",
          },
        });
        expect(other.readChatState(AGENT_MEMORY)).toBe(AGENT_MEMORY.initial);
      });

      it("runs one consolidation per agent at a time (designdocs/CUSTOM_AGENTS.md §5)", async () => {
        const { keeper } = buildKeeper();
        const landing = deferred<typeof CONSOLIDATED>();
        mockConsolidate.mockReturnValue(landing.promise);

        const first = keeper.consolidateNow("jennifer");
        const second = await keeper.consolidateNow("jennifer");

        expect(second).toEqual({ status: "skipped", reason: "no-new-notes" });
        expect(mockConsolidate).toHaveBeenCalledTimes(1);
        landing.resolve(CONSOLIDATED);
        await first;
      });
    });

    describe("consolidateStaleAgentsOnLoad()", () => {
      function storedThrough(files: ReturnType<typeof buildKeeper>["files"], date: string) {
        files.readMemoryDocument.mockResolvedValue({
          body: "",
          consolidatedThrough: date,
          modifiedAtMs: 0,
          hash: "h",
          text: "",
        } as never);
      }

      it("catches up on an agent whose last consolidation is more than a day old", async () => {
        const { keeper, files } = buildKeeper();
        mockHasUnconsolidatedNotes.mockResolvedValue(true);
        storedThrough(files, "2020-01-01");

        await keeper.consolidateStaleAgentsOnLoad();

        expect(mockConsolidate).toHaveBeenCalledTimes(1);
      });

      it("leaves a recently consolidated agent for the idle window instead", async () => {
        const { keeper, files } = buildKeeper();
        mockHasUnconsolidatedNotes.mockResolvedValue(true);
        storedThrough(files, formatMemoryEntryDate(new Date()));

        await keeper.consolidateStaleAgentsOnLoad();

        expect(mockConsolidate).not.toHaveBeenCalled();
      });

      it("leaves alone an agent with no new notes, or whose memory is off", async () => {
        const { keeper } = buildKeeper([
          jennifer(),
          jennifer({ slug: "sage", memoryEnabled: false }),
        ]);
        mockHasUnconsolidatedNotes.mockImplementation(async (_files, slug) => slug === "sage");

        await keeper.consolidateStaleAgentsOnLoad();

        expect(mockConsolidate).not.toHaveBeenCalled();
      });
    });
  });
});
