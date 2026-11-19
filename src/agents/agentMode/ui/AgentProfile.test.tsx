import { AgentProfile } from "@/agents/agentMode/ui/AgentProfile";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const FOLDER = "copilot/agents/coco";
const COCO = {
  slug: "coco",
  name: "Coco",
  title: "Keeps the whole vault in view",
  instruction: "You keep the whole vault in view.",
  faceSrc: "face:coco",
  instructionsPath: `${FOLDER}/instructions.md`,
  memoryPath: `${FOLDER}/MEMORY.md`,
} as CustomAgent;

async function setup() {
  const vault = createFakeAgentVault();
  vault.writeByHand(
    COCO.instructionsPath,
    "---\nname: Coco\n---\nYou keep the whole vault in view."
  );
  vault.writeByHand(COCO.memoryPath, "## How to work\n\nLead with user value.\n");
  const newLeaf = { openFile: jest.fn().mockResolvedValue(undefined) };
  const app = {
    ...vault.app,
    workspace: { getLeavesOfType: () => [], getLeaf: jest.fn(() => newLeaf) },
  } as unknown as App;
  const manager = {
    getChatHistoryItems: jest.fn(async () => [{ id: "a.md", agent: "coco" }]),
  } as unknown as AgentSessionManager;
  const handlers = { onBack: jest.fn(), onNewChat: jest.fn() };
  render(<AgentProfile agent={COCO} app={app} manager={manager} {...handlers} />);
  await waitFor(() => expect(screen.getByText(/^1 chat/)).not.toBeNull());
  return { app, newLeaf, handlers };
}

describe("AgentProfile", () => {
  describe("AgentProfile()", () => {
    it("shows the agent's chats and its saved rules from the vault", async () => {
      await setup();

      expect(screen.getByText(/^1 chat · since /)).not.toBeNull();
      expect(screen.getByRole("button", { name: /Rules Coco remembers/ }).textContent).toContain(
        "1 rule"
      );
    });

    it("opens the agent's instructions.md in a new tab of the main editor area from its row", async () => {
      const { app, newLeaf } = await setup();

      fireEvent.click(screen.getByRole("button", { name: /What Coco handles/ }));

      await waitFor(() =>
        expect(newLeaf.openFile).toHaveBeenCalledWith(
          app.vault.getAbstractFileByPath(COCO.instructionsPath),
          { active: true, eState: undefined }
        )
      );
    });

    it("starts a new chat with this agent and goes back", async () => {
      const { handlers } = await setup();

      fireEvent.click(screen.getByRole("button", { name: "New chat with Coco" }));
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

      expect(handlers.onNewChat).toHaveBeenCalledWith(COCO);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    });
  });
});
