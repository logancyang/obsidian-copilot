import { setSettings } from "@/settings/model";
import { protectedInstructionFiles } from "@/agents/agentMode/protectedInstructionFiles";

describe("protectedInstructionFiles", () => {
  describe("protectedInstructionFiles()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 protects every instructions.md in the agents folder the user configured, and tells the model where the user edits an instruction or creates an agent", () => {
      setSettings({ copilotFolder: "Tools/My Copilot" });

      expect(protectedInstructionFiles("/Users/me/vault")).toEqual({
        folder: "/Users/me/vault/Tools/My Copilot/agents",
        fileName: "instructions.md",
        reason:
          "Copilot refused this change: only the user edits an agent's instructions.md and creates agents. Give the user the agent's Open instruction link to edit its instruction, or draft a new agent for them to review and create from the card.",
      });
    });
  });
});
