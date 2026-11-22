import { useAgentProfileFacts } from "@/agents/agentMode/ui/useAgentProfileFacts";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { act, renderHook, waitFor } from "@testing-library/react";
import { TFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";

const FOLDER = "copilot/teammates/coco";
const COCO = {
  slug: "coco",
  name: "Coco",
  instructionsPath: `${FOLDER}/instructions.md`,
  memoryPath: `${FOLDER}/MEMORY.md`,
} as CustomAgent;

const TWO_RULES =
  "## How to work\n\nLead with user value.\n2026-11-02 · Asked\n\n## Where to find things\n\nReceipts are in Finance/.\n2026-11-03 · Told\n";

function chat(id: string, agent?: string): ChatHistoryItem {
  return { id, title: id, agent, createdAt: new Date(0), lastAccessedAt: new Date(0) };
}

function setup(memory?: string) {
  const vault = createFakeAgentVault();
  vault.writeByHand(COCO.instructionsPath, "---\nname: Coco\n---\nYou keep the vault in view.");
  if (memory !== undefined) vault.writeByHand(COCO.memoryPath, memory);
  const manager = {
    getChatHistoryItems: jest.fn(async () => [
      chat("a.md", "coco"),
      chat("b.md", "coco"),
      chat("c.md"),
    ]),
  } as unknown as AgentSessionManager;
  const fileStat = (path: string) => {
    const file = vault.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`No file at ${path}`);
    return file.stat;
  };
  return { vault, manager, fileStat };
}

describe("useAgentProfileFacts", () => {
  describe("useAgentProfileFacts()", () => {
    it("counts the agent's chats and its memory rules, with when MEMORY.md last changed and when instructions.md was made and last edited", async () => {
      const { vault, manager, fileStat } = setup(TWO_RULES);
      fileStat(COCO.instructionsPath).ctime = 1_000;
      fileStat(COCO.instructionsPath).mtime = 2_000;

      const { result } = renderHook(() => useAgentProfileFacts(vault.app, manager, COCO));

      await waitFor(() =>
        expect(result.current).toEqual({
          chatCount: 2,
          createdAt: 1_000,
          editedAt: 2_000,
          memory: { rules: 2, changedAt: fileStat(COCO.memoryPath).mtime },
        })
      );
    });

    it(`reports no memory while MEMORY.md does not exist, as for a new agent (${ISSUE})`, async () => {
      const { vault, manager } = setup();

      const { result } = renderHook(() => useAgentProfileFacts(vault.app, manager, COCO));

      await waitFor(() => expect(result.current.chatCount).toBe(2));
      expect(result.current.memory).toBeNull();
    });

    it(`follows MEMORY.md as the agent saves its first rule and the user edits it (${ISSUE})`, async () => {
      const { vault, manager, fileStat } = setup();
      const { result } = renderHook(() => useAgentProfileFacts(vault.app, manager, COCO));
      await waitFor(() => expect(result.current.chatCount).toBe(2));

      act(() => vault.writeByHand(COCO.memoryPath, "## How to work\n\nLead with user value.\n"));
      await waitFor(() => expect(result.current.memory?.rules).toBe(1));
      act(() => vault.writeByHand(COCO.memoryPath, TWO_RULES));

      await waitFor(() =>
        expect(result.current.memory).toEqual({
          rules: 2,
          changedAt: fileStat(COCO.memoryPath).mtime,
        })
      );
    });
  });
});
