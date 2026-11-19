import { deleteAgentWithChats, listAgentChats } from "@/agents/agentMode/agentChats";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { getFrontMatterInfo, parseYaml, TFile, type App } from "obsidian";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { trashFile } from "@/utils/vaultAdapterUtils";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { updateCachedProjectRecords } from "@/projects/state";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import type { ProjectFileRecord } from "@/projects/type";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";

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
  afterEach(() => updateCachedProjectRecords([]));

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

  describe("deleteAgentWithChats()", () => {
    const COPILOT_CHAT = chat("copilot.md");
    const HISTORY = [
      chat("coco-1.md", "coco"),
      chat("native:claude:s1", "coco"),
      chat("maya.md", "maya"),
      COPILOT_CHAT,
      chat("cocoa.md", "cocoa"),
    ];

    async function setup({
      host = { agentSlug: "coco", hasMessages: true },
      failingChat = "",
      history = HISTORY,
      notes = {},
      notesOf = {},
    }: {
      host?: { agentSlug: string; hasMessages: boolean };
      failingChat?: string;
      history?: ChatHistoryItem[];
      notes?: Record<string, string>;
      notesOf?: Record<string, string[]>;
    } = {}) {
      resetSettings();
      const vault = createFakeAgentVault();
      for (const slug of ["coco", "cocoa", "maya"]) {
        vault.writeByHand(`copilot/agents/${slug}/instructions.md`, `---\nname: ${slug}\n---\nHi.`);
      }
      vault.writeByHand("copilot/agents/coco/MEMORY.md", "## How to work\n");
      vault.writeByHand("copilot/agents/coco/face.webp", new ArrayBuffer(1));
      for (const [path, frontmatter] of Object.entries(notes)) {
        vault.writeByHand(path, `---\n${frontmatter}\n---\nHi.`);
      }
      const app = {
        ...vault.app,
        metadataCache: {
          getCache: () => null,
          getFileCache: (file: TFile) => {
            const info = getFrontMatterInfo(vault.readText(file.path) ?? "");
            return info.exists
              ? { frontmatter: parseYaml(info.frontmatter) as Record<string, unknown> }
              : null;
          },
        },
      } as unknown as App;
      const store = new CustomAgentStore(vault.app);
      await store.start();
      const steps: string[] = [];
      const manager = {
        getChatHistoryItems: jest.fn(async (scope: string) =>
          scope === GLOBAL_SCOPE ? history : []
        ),
        getSession: (id: string) =>
          id === "host"
            ? { agentSlug: host.agentSlug, hasUserVisibleMessages: () => host.hasMessages }
            : undefined,
        startNewChatInPlace: jest.fn(async (id: string) => {
          steps.push(`new chat in place of ${id}`);
        }),
        deleteChatHistory: jest.fn(
          async (id: string, options?: { canTrashNote?: (path: string) => boolean }) => {
            if (id === failingChat) throw new Error("locked");
            steps.push(`delete ${id}`);
            for (const path of notesOf[id] ?? [id]) {
              if (options?.canTrashNote && !options.canTrashNote(path)) continue;
              const file = app.vault.getAbstractFileByPath(path);
              if (file) await trashFile(app, file);
            }
          }
        ),
      } as unknown as AgentSessionManager;
      const remove = () =>
        deleteAgentWithChats({ app, manager, store, slug: "coco", hostSessionId: "host" });
      return { vault, store, steps, remove };
    }

    it(`trashes only the agent's folder and deletes only the chats recorded with its slug (${ISSUE})`, async () => {
      const { vault, steps, remove } = await setup();

      const result = await remove();

      expect(result).toEqual({ deletedChats: 2, failedChats: 0, agentDeleted: true });
      expect(steps.filter((step) => step.startsWith("delete"))).toEqual([
        "delete coco-1.md",
        "delete native:claude:s1",
      ]);
      expect(vault.trashedPaths).toEqual(["copilot/agents/coco"]);
      expect(vault.listPaths()).toEqual([
        "copilot/agents/cocoa/instructions.md",
        "copilot/agents/maya/instructions.md",
      ]);
    });

    it(`trashes a chat's note only when the note is in the chats folder and itself records the agent, so a moved, re-tagged or replaced note stays (${ISSUE})`, async () => {
      const chats = "copilot/copilot-conversations";
      const { vault, remove } = await setup({
        history: [
          chat(`${chats}/agent__coco.md`, "coco"),
          chat(`${chats}/agent__retagged.md`, "coco"),
          chat("native:claude:moved", "coco"),
          chat("native:claude:replaced", "coco"),
        ],
        notes: {
          [`${chats}/agent__coco.md`]: "agent: coco",
          [`${chats}/agent__retagged.md`]: "agent: [coco]",
          "Notes/agent__moved.md": "agent: coco",
          [`${chats}/agent__replaced.md`]: "agent: maya",
        },
        notesOf: {
          "native:claude:moved": ["Notes/agent__moved.md"],
          "native:claude:replaced": [`${chats}/agent__replaced.md`],
        },
      });

      const result = await remove();

      expect(result).toEqual({ deletedChats: 4, failedChats: 0, agentDeleted: true });
      expect(vault.trashedPaths).toEqual([`${chats}/agent__coco.md`, "copilot/agents/coco"]);
    });

    it(`turns the agent's chat the profile covers into a new chat before deleting it, so the tab returns to the agent home (${ISSUE})`, async () => {
      const { steps, remove } = await setup();

      await remove();

      expect(steps[0]).toBe("new chat in place of host");
    });

    it("leaves the new chat page the profile covers in place", async () => {
      const { steps, remove } = await setup({ host: { agentSlug: "coco", hasMessages: false } });

      await remove();

      expect(steps).not.toContain("new chat in place of host");
    });

    it(`stops new chats from opening on the deleted agent (${ISSUE})`, async () => {
      const { remove } = await setup();
      setSettings({ agentMode: { ...getSettings().agentMode, lastCustomAgent: "coco" } });

      await remove();

      expect(getSettings().agentMode.lastCustomAgent).toBeUndefined();
    });

    it(`keeps the agent's folder when one of its chats could not be deleted, so that chat is still the agent's (${ISSUE})`, async () => {
      const { vault, remove } = await setup({ failingChat: "coco-1.md" });

      const result = await remove();

      expect(result).toEqual({ deletedChats: 1, failedChats: 1, agentDeleted: false });
      expect(vault.trashedPaths).toEqual([]);
      expect(vault.listPaths()).toContain("copilot/agents/coco/instructions.md");
    });

    it(`deletes nothing when the agent's folder is already gone at confirm (${ISSUE})`, async () => {
      const { vault, steps, remove, store } = await setup();
      vault.deleteByHand("copilot/agents/coco/instructions.md");
      await store.start();

      const result = await remove();

      expect(result).toEqual({ deletedChats: 0, failedChats: 0, agentDeleted: false });
      expect(steps).toEqual([]);
      expect(vault.trashedPaths).toEqual([]);
    });

    it(`deletes nothing when custom agents stopped between the dialog and the confirm (${ISSUE})`, async () => {
      const { vault, steps, remove, store } = await setup();
      store.stop();

      const result = await remove();

      expect(result).toEqual({ deletedChats: 0, failedChats: 0, agentDeleted: false });
      expect(steps).toEqual([]);
      expect(vault.listPaths()).toContain("copilot/agents/coco/instructions.md");
    });

    it(`reports the chats it deleted when the agent's folder can't go to the trash (${ISSUE})`, async () => {
      const { steps, remove, store } = await setup();
      jest.spyOn(store, "deleteAgent").mockRejectedValueOnce(new Error("trash refused"));

      const result = await remove();

      expect(result).toEqual({ deletedChats: 2, failedChats: 0, agentDeleted: false });
      expect(steps).toContain("delete coco-1.md");
    });
  });
});
