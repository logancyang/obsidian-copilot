import { listAgentChats } from "@/agents/agentMode/agentChats";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { updateCachedProjectRecords } from "@/projects/state";
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

    it(`never lists another agent's chat, a Copilot chat, or a chat whose agent only starts with the same letters (${ISSUE})`, async () => {
      const { manager } = fakeManager({
        [GLOBAL_SCOPE]: [
          chat("coco.md", "coco"),
          chat("maya.md", "maya"),
          chat("copilot.md"),
          chat("cocoa.md", "cocoa"),
          chat("coco-2.md", "coco-2"),
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
});
