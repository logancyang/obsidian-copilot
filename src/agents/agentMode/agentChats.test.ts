import {
  agentBackend,
  agentSetupProblem,
  agentSetupReason,
  agentToSetUpBeforeChat,
  deleteAgentAndArchiveChats,
  listAgentChats,
  listAllChats,
} from "@/agents/agentMode/agentChats";
import { AgentUnavailableError } from "@/agents/agentUnavailableError";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import type { EnabledModelEntry, InstallState } from "@/agentMode/session/types";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { updateCachedProjectRecords } from "@/projects/state";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import type { ProjectFileRecord } from "@/projects/type";
import {
  opencodeAgentsFilePath,
  writeAgentsFile,
} from "@/agentMode/backends/opencode/opencodeCustomAgents";
import { useHermeticHome } from "@/agentMode/backends/opencode/testing/hermeticHome";
import * as fs from "node:fs";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";
const STOP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/945";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";
const RECALL_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/959";
const ENTRIES_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/991";
const READY: InstallState = { kind: "ready", source: "managed" };
const ABSENT: InstallState = { kind: "absent" };

function enabled(baseModelId: string, credentialState: "ok" | "missing_key" = "ok") {
  return { baseModelId, name: baseModelId, credentialState } as EnabledModelEntry;
}

function setUpDevice(installed: { opencode: InstallState; claude: InstallState }) {
  jest
    .spyOn(OpencodeBackendDescriptor, "getEnabledModelEntries")
    .mockReturnValue([enabled("opencode/big-pickle"), enabled("gpt-byok", "missing_key")]);
  jest.spyOn(ClaudeBackendDescriptor, "getEnabledModelEntries").mockReturnValue([enabled("haiku")]);
  jest.spyOn(CodexBackendDescriptor, "getEnabledModelEntries").mockReturnValue([]);
  jest.spyOn(OpencodeBackendDescriptor, "getInstallState").mockReturnValue(installed.opencode);
  jest.spyOn(ClaudeBackendDescriptor, "getInstallState").mockReturnValue(installed.claude);
  jest.spyOn(CodexBackendDescriptor, "getInstallState").mockReturnValue(ABSENT);
}

function withDefaultBackend(activeBackend: string) {
  setSettings({ agentMode: { ...getSettings().agentMode, activeBackend } });
  return getSettings();
}

function chat(id: string, agent?: string): ChatHistoryItem {
  return { id, title: id, agent, createdAt: new Date(0), lastAccessedAt: new Date(0) };
}

function project(id: string, archivedAt?: number): ProjectFileRecord {
  return { project: { id, name: id, archivedAt } } as unknown as ProjectFileRecord;
}

function fakeManager(chatsByScope: Record<string, ChatHistoryItem[]>) {
  const getChatHistoryItems = jest.fn(async (scope: string) => chatsByScope[scope] ?? []);
  return {
    manager: { getChatHistoryItems } as unknown as AgentSessionManager,
    getChatHistoryItems,
  };
}

describe("agentChats", () => {
  afterEach(() => {
    updateCachedProjectRecords([]);
    jest.restoreAllMocks();
  });

  describe("agentSetupProblem()", () => {
    beforeEach(() => resetSettings());

    it(`finds nothing wrong with an agent whose model is enabled for a coding agent that is set up here (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: READY, claude: READY });

      expect(
        agentSetupProblem(getSettings(), { baseModelId: "opencode/big-pickle", effort: null })
      ).toBeNull();
    });

    it(`names the coding agent when the model's coding agent isn't set up on this device (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: ABSENT, claude: READY });

      expect(
        agentSetupProblem(getSettings(), { baseModelId: "opencode/big-pickle", effort: null })
      ).toEqual({ kind: "coding_agent", backendId: "opencode" });
    });

    it(`names the model when no coding agent here has it enabled, or its coding agent can't use it yet (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: READY, claude: READY });

      expect(agentSetupProblem(getSettings(), { baseModelId: "gpt-6", effort: null })).toEqual({
        kind: "model",
        modelName: "gpt-6",
      });
      expect(agentSetupProblem(getSettings(), { baseModelId: "gpt-byok", effort: null })).toEqual({
        kind: "model",
        modelName: "gpt-byok",
      });
    });

    it(`names a model that can't run here as the model picker names it, or by the last part of its id when Copilot doesn't list it (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: READY, claude: READY });
      setSettings({
        configuredModels: [
          {
            ...getSettings().configuredModels[0],
            info: { id: "sonnet", displayName: "Sonnet 5.5" },
          },
        ],
      });

      expect(agentSetupProblem(getSettings(), { baseModelId: "sonnet", effort: null })).toEqual({
        kind: "model",
        modelName: "Sonnet 5.5",
      });
      expect(
        agentSetupProblem(getSettings(), { baseModelId: "copilot-plus/glm-9", effort: null })
      ).toEqual({ kind: "model", modelName: "glm-9" });
    });

    it(`checks an agent saved without a model against the vault's default coding agent (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: ABSENT, claude: READY });

      expect(agentSetupProblem(withDefaultBackend("claude"), null)).toBeNull();
      expect(agentSetupProblem(withDefaultBackend("opencode"), null)).toEqual({
        kind: "coding_agent",
        backendId: "opencode",
      });
    });

    it(`treats a coding agent still checking its install as set up, so no agent locks while Obsidian starts (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: READY, claude: { kind: "checking", source: "custom" } });

      expect(agentSetupProblem(getSettings(), { baseModelId: "haiku", effort: null })).toBeNull();
    });
  });

  describe("agentSetupReason()", () => {
    it(`says in plain words which coding agent or model can't run here (${SETUP_ISSUE})`, () => {
      expect(agentSetupReason("Leo", { kind: "coding_agent", backendId: "opencode" })).toBe(
        "Leo runs on OpenCode, which isn't set up on this device."
      );
      expect(agentSetupReason("Leo", { kind: "model", modelName: "Big Pickle" })).toBe(
        "Leo's model, Big Pickle, isn't available on this device."
      );
    });
  });

  describe("agentToSetUpBeforeChat()", () => {
    const problems = new Map([
      ["leo", { kind: "coding_agent", backendId: "opencode" } as const],
      ["nora", { kind: "model", modelName: "Sonnet 5.5" } as const],
    ]);

    it(`names the agent whose profile opens in place of its saved chat when the chat's coding agent isn't set up on this device (${SETUP_ISSUE})`, () => {
      expect(agentToSetUpBeforeChat({ agent: "leo", backendId: "opencode" }, problems)).toBe("leo");
    });

    it(`opens the chat itself when it ran on another coding agent, its agent's only problem is the model, or it has no agent (${SETUP_ISSUE})`, () => {
      expect(agentToSetUpBeforeChat({ agent: "leo", backendId: "claude" }, problems)).toBeNull();
      expect(agentToSetUpBeforeChat({ agent: "nora", backendId: "claude" }, problems)).toBeNull();
      expect(agentToSetUpBeforeChat({ agent: "maya", backendId: "claude" }, problems)).toBeNull();
      expect(agentToSetUpBeforeChat({ backendId: "opencode" }, problems)).toBeNull();
    });
  });

  describe("agentBackend()", () => {
    beforeEach(() => resetSettings());

    function managerSeeding() {
      return {
        getSeedSelection: jest.fn((_backendId: string, preferred: unknown) => preferred),
      } as unknown as AgentSessionManager;
    }

    it("picks the coding agent that runs the agent's model, seeded with that model", () => {
      setUpDevice({ opencode: READY, claude: READY });
      const model = { baseModelId: "haiku", effort: "low" };

      expect(agentBackend(managerSeeding(), { name: "Leo", model })).toEqual({
        backendId: "claude",
        seed: model,
      });
    });

    it(`refuses an agent whose model can't run here with the reason, instead of starting it on another coding agent or model (${SETUP_ISSUE})`, () => {
      setUpDevice({ opencode: ABSENT, claude: READY });
      const manager = managerSeeding();

      const start = () =>
        agentBackend(manager, {
          name: "Leo",
          model: { baseModelId: "opencode/big-pickle", effort: null },
        });

      expect(start).toThrow(AgentUnavailableError);
      expect(start).toThrow("Leo runs on OpenCode, which isn't set up on this device.");
      expect(manager.getSeedSelection).not.toHaveBeenCalled();
    });
  });

  describe("listAllChats()", () => {
    it(`lists the all-chats list's chats, archived ones included, then each archived project's, so an agent recalls chats the user put away (${RECALL_ISSUE})`, async () => {
      updateCachedProjectRecords([project("launch", 10), project("books")]);
      const archived = { ...chat("coco-archived.md", "coco"), archivedAt: 5 };
      const { manager, getChatHistoryItems } = fakeManager({
        [GLOBAL_SCOPE]: [chat("coco-1.md", "coco"), archived, chat("copilot.md")],
        launch: [chat("launch-coco.md", "coco"), chat("launch-maya.md", "maya")],
        books: [chat("books-coco.md", "coco")],
      });

      const chats = await listAllChats(manager);

      expect(chats.map((c) => c.id)).toEqual([
        "coco-1.md",
        "coco-archived.md",
        "copilot.md",
        "launch-coco.md",
        "launch-maya.md",
      ]);
      expect(getChatHistoryItems.mock.calls.map(([scope]) => scope)).toEqual([
        GLOBAL_SCOPE,
        "launch",
      ]);
    });
  });

  describe("listAgentChats()", () => {
    it("lists every chat recorded with the agent's slug, archived ones included", async () => {
      const archived = { ...chat("coco-archived.md", "coco"), archivedAt: 5 };
      const { manager } = fakeManager({
        [GLOBAL_SCOPE]: [chat("coco-1.md", "coco"), archived, chat("native:claude:s1", "coco")],
      });

      const chats = await listAgentChats(manager, "coco");

      expect(chats.map((c) => c.id)).toEqual(["coco-1.md", "coco-archived.md", "native:claude:s1"]);
    });

    it(`never lists another agent's chat, a Copilot chat, or a chat whose agent only starts with the same letters or differs in case or a trailing slash (${ISSUE})`, async () => {
      const { manager } = fakeManager({
        [GLOBAL_SCOPE]: [
          chat("coco.md", "coco"),
          chat("maya.md", "maya"),
          chat("copilot.md"),
          chat("cocoa.md", "cocoa"),
          chat("coco-2.md", "coco-2"),
          chat("co.md", "co"),
          chat("upper.md", "Coco"),
          chat("slash.md", "coco/"),
        ],
      });

      const chats = await listAgentChats(manager, "coco");

      expect(chats.map((c) => c.id)).toEqual(["coco.md"]);
    });

    it(`also lists the agent's chats in archived projects, which the all-chats list leaves out (${ISSUE})`, async () => {
      updateCachedProjectRecords([project("launch", 10), project("books")]);
      const { manager, getChatHistoryItems } = fakeManager({
        [GLOBAL_SCOPE]: [chat("coco-1.md", "coco")],
        launch: [chat("launch-coco.md", "coco"), chat("launch-maya.md", "maya")],
      });

      const chats = await listAgentChats(manager, "coco");

      expect(chats.map((c) => c.id)).toEqual(["coco-1.md", "launch-coco.md"]);
      expect(getChatHistoryItems.mock.calls.map(([scope]) => scope)).toEqual([
        GLOBAL_SCOPE,
        "launch",
      ]);
    });
  });

  describe("deleteAgentAndArchiveChats()", () => {
    useHermeticHome();
    const CHATS = "copilot/copilot-conversations";
    const HISTORY = [
      chat(`${CHATS}/coco-1.md`, "coco"),
      chat("native:claude:s1", "coco"),
      { ...chat(`${CHATS}/coco-old.md`, "coco"), archivedAt: 5 },
      chat(`${CHATS}/maya.md`, "maya"),
      chat(`${CHATS}/copilot.md`),
      chat(`${CHATS}/cocoa.md`, "cocoa"),
    ];

    async function setup({
      host = { agentSlug: "coco", hasMessages: true },
      failingChat = "",
      projectChats = [],
    }: {
      host?: { agentSlug: string; hasMessages: boolean };
      failingChat?: string;
      projectChats?: ChatHistoryItem[];
    } = {}) {
      resetSettings();
      const vault = createFakeAgentVault();
      for (const slug of ["coco", "cocoa", "maya"]) {
        vault.writeByHand(
          `copilot/teammates/${slug}/instructions.md`,
          `---\nname: ${slug}\n---\nHi.`
        );
      }
      vault.writeByHand("copilot/teammates/coco/MEMORY.md", "## How to work\n");
      vault.writeByHand("copilot/teammates/coco/face.webp", new ArrayBuffer(1));
      for (const { id, agent } of [...HISTORY, ...projectChats]) {
        if (!id.startsWith("native:"))
          vault.writeByHand(id, `---\nagent: ${agent ?? ""}\n---\nHi.`);
      }
      const store = new CustomAgentStore(vault.app);
      await store.start();
      const steps: string[] = [];
      const manager = {
        getChatHistoryItems: jest.fn(async (scope: string) =>
          scope === GLOBAL_SCOPE ? HISTORY : projectChats
        ),
        getSession: (id: string) =>
          id === "host"
            ? { agentSlug: host.agentSlug, hasUserVisibleMessages: () => host.hasMessages }
            : undefined,
        startNewChatInPlace: jest.fn(async (id: string) => {
          steps.push(`new chat in place of ${id}`);
        }),
        closeChatSession: jest.fn(async (id: string) => {
          steps.push(`close ${id}`);
        }),
        setChatArchived: jest.fn(async (id: string, archived: boolean) => {
          if (id === failingChat) throw new Error("Chat note not found");
          steps.push(`${archived ? "archive" : "unarchive"} ${id}`);
          return { id, archivedAt: archived ? 10 : undefined };
        }),
      } as unknown as AgentSessionManager;
      const hiddenChats = {
        stopAgent: jest.fn((slug: string): void => {
          steps.push(`stop ${slug}`);
        }),
      };
      const remove = () =>
        deleteAgentAndArchiveChats({
          app: vault.app,
          manager,
          store,
          slug: "coco",
          hostSessionId: "host",
          hiddenChats,
        });
      const archived = () =>
        steps.filter((step) => step.startsWith("archive")).map((step) => step.slice(8));
      return { vault, store, steps, remove, archived, hiddenChats, manager };
    }

    it(`trashes only the agent's folder and archives the agent's chats, keeping every chat note in the vault (${ISSUE})`, async () => {
      const { vault, remove, archived } = await setup();

      const result = await remove();

      expect(result).toEqual({ archivedChats: 2, agentDeleted: true });
      expect(archived()).toEqual([`${CHATS}/coco-1.md`, "native:claude:s1"]);
      expect(vault.trashedPaths).toEqual(["copilot/teammates/coco"]);
      expect(vault.listPaths()).toEqual([
        `${CHATS}/coco-1.md`,
        `${CHATS}/coco-old.md`,
        `${CHATS}/cocoa.md`,
        `${CHATS}/copilot.md`,
        `${CHATS}/maya.md`,
        "copilot/teammates/cocoa/instructions.md",
        "copilot/teammates/maya/instructions.md",
      ]);
    });

    it(`leaves a chat already archived, and the agent's chats in an archived project, as they are (${ISSUE})`, async () => {
      updateCachedProjectRecords([project("launch", 10)]);
      const { remove, archived, manager } = await setup({
        projectChats: [{ ...chat(`${CHATS}/launch-coco.md`, "coco"), projectId: "launch" }],
      });

      await remove();

      expect(archived()).not.toContain(`${CHATS}/coco-old.md`);
      expect(archived()).not.toContain(`${CHATS}/launch-coco.md`);
      expect(manager.closeChatSession).not.toHaveBeenCalledWith(`${CHATS}/launch-coco.md`);
    });

    it(`closes each chat it archives, so a reply still running stops instead of answering as an agent that no longer exists (${ISSUE})`, async () => {
      const { steps, remove } = await setup();

      await remove();

      expect(steps.filter((step) => /^(close|archive) /.test(step))).toEqual([
        `close ${CHATS}/coco-1.md`,
        `archive ${CHATS}/coco-1.md`,
        "close native:claude:s1",
        "archive native:claude:s1",
      ]);
    });

    it(`still archives an open chat its coding agent can't close (${ISSUE})`, async () => {
      const { remove, archived, manager } = await setup();
      jest
        .mocked(manager.closeChatSession)
        .mockRejectedValueOnce(new Error("This agent can't shut down a single chat."));

      const result = await remove();

      expect(result).toEqual({ archivedChats: 2, agentDeleted: true });
      expect(archived()).toEqual([`${CHATS}/coco-1.md`, "native:claude:s1"]);
    });

    it(`turns the agent's chat the profile covers into a new chat first, so the tab returns to the agent home (${ISSUE})`, async () => {
      const { steps, remove } = await setup();

      await remove();

      expect(steps[0]).toBe("new chat in place of host");
    });

    it(`still deletes the agent and archives its chats when the vault's default coding agent can't start the new chat (${SETUP_ISSUE})`, async () => {
      const { vault, remove, manager, hiddenChats } = await setup();
      jest
        .mocked(manager.startNewChatInPlace)
        .mockRejectedValueOnce(new Error("OpenCode isn't installed"));

      const result = await remove();

      expect(result).toEqual({ archivedChats: 2, agentDeleted: true });
      expect(vault.trashedPaths).toEqual(["copilot/teammates/coco"]);
      expect(hiddenChats.stopAgent).toHaveBeenCalledWith("coco");
    });

    it("leaves the new chat page the profile covers in place", async () => {
      const { steps, remove } = await setup({ host: { agentSlug: "coco", hasMessages: false } });

      await remove();

      expect(steps).not.toContain("new chat in place of host");
    });

    it(`stops new chats from opening on the deleted agent (${ISSUE})`, async () => {
      const { remove } = await setup();
      setSettings({ agentMode: { ...getSettings().agentMode, lastTeammate: "coco" } });

      await remove();

      expect(getSettings().agentMode.lastTeammate).toBeUndefined();
    });

    it(`still deletes the agent when one of its chats can't be archived, and counts only the chats it archived (${ISSUE})`, async () => {
      const { vault, remove, archived } = await setup({ failingChat: `${CHATS}/coco-1.md` });

      const result = await remove();

      expect(result).toEqual({ archivedChats: 1, agentDeleted: true });
      expect(archived()).toEqual(["native:claude:s1"]);
      expect(vault.trashedPaths).toEqual(["copilot/teammates/coco"]);
    });

    it(`removes the agent's entries from the vault's OpenCode agents file and keeps the other agents' (${ENTRIES_ISSUE})`, async () => {
      const { vault, remove } = await setup();
      const file = opencodeAgentsFilePath(vault.app);
      await writeAgentsFile(
        file,
        JSON.stringify({
          agents: {
            "copilot-teammate-coco/default": { system: "COCO-OWN" },
            "copilot-teammate-coco/asked/auto": { system: "COCO-ASKED" },
            "copilot-teammate-cocoa/default": { system: "COCOA" },
          },
        })
      );

      await remove();

      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
        agents: { "copilot-teammate-cocoa/default": { system: "COCOA" } },
      });
    });

    it(`still deletes the agent and archives its chats when its OpenCode entries can't be removed (${ENTRIES_ISSUE})`, async () => {
      const { vault, remove, archived } = await setup();
      const file = opencodeAgentsFilePath(vault.app);
      await writeAgentsFile(file, '{"agents":{"copilot-teammate-coco/default":{}}}');
      jest.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("EPERM: file is open"));

      const result = await remove();

      expect(result).toEqual({ archivedChats: 2, agentDeleted: true });
      expect(archived()).toEqual([`${CHATS}/coco-1.md`, "native:claude:s1"]);
    });

    it(`stops the agent wherever an @ runs it before its folder goes to the trash (${STOP_ISSUE})`, async () => {
      const { vault, remove, hiddenChats } = await setup();
      hiddenChats.stopAgent.mockImplementation(() => {
        expect(vault.trashedPaths).toEqual([]);
      });

      await remove();

      expect(hiddenChats.stopAgent).toHaveBeenCalledWith("coco");
      expect(vault.trashedPaths).toEqual(["copilot/teammates/coco"]);
    });

    it(`changes nothing when the agent's folder is already gone at confirm (${ISSUE})`, async () => {
      const { vault, steps, remove, store } = await setup();
      vault.deleteByHand("copilot/teammates/coco/instructions.md");
      await store.start();

      const result = await remove();

      expect(result).toEqual({ archivedChats: 0, agentDeleted: false });
      expect(steps).toEqual([]);
      expect(vault.trashedPaths).toEqual([]);
    });

    it(`changes nothing when custom agents stopped between the dialog and the confirm (${ISSUE})`, async () => {
      const { vault, steps, remove, store } = await setup();
      store.stop();

      const result = await remove();

      expect(result).toEqual({ archivedChats: 0, agentDeleted: false });
      expect(steps).toEqual([]);
      expect(vault.listPaths()).toContain("copilot/teammates/coco/instructions.md");
    });

    it(`archives none of the agent's chats when its folder can't go to the trash (${ISSUE})`, async () => {
      const { archived, remove, store } = await setup();
      jest.spyOn(store, "deleteAgent").mockRejectedValueOnce(new Error("trash refused"));

      const result = await remove();

      expect(result).toEqual({ archivedChats: 0, agentDeleted: false });
      expect(archived()).toEqual([]);
    });
  });
});
