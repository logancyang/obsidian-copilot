import { setSettings } from "@/settings/model";
import { protectedInstructionFiles } from "@/agents/agentMode/protectedInstructionFiles";

describe("protectedInstructionFiles", () => {
  describe("protectedInstructionFiles()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 protects each agent's instructions.md in the agents folder the user configured, and tells the model only the user edits one or creates an agent", () => {
      setSettings({ copilotFolder: "Tools/My Copilot" });

      expect(protectedInstructionFiles("/Users/me/vault")).toEqual({
        folder: "/Users/me/vault/Tools/My Copilot/agents",
        fileName: "instructions.md",
        reason:
          "Copilot refused this change: only the user edits an agent's instructions.md and creates agents.",
      });
    });
  });
});
