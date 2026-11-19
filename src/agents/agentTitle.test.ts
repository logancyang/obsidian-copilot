import { agentTitle } from "@/agents/agentTitle";

describe("agentTitle", () => {
  describe("agentTitle()", () => {
    it("shows the title the agent's file sets", () => {
      expect(
        agentTitle({ title: "Keeps the vault in view", instruction: "Be direct. Cite notes." })
      ).toBe("Keeps the vault in view");
    });

    it("uses the instruction's first sentence when the title is empty (https://github.com/Brevilabs/obsidian-copilot-private/issues/588)", () => {
      expect(
        agentTitle({ title: "", instruction: "Product critic. Pushes back on plans.\nBe blunt." })
      ).toBe("Product critic.");
    });

    it("uses the instruction's first line when it has no sentence end, without heading or list marks (https://github.com/Brevilabs/obsidian-copilot-private/issues/588)", () => {
      expect(agentTitle({ title: "  ", instruction: "\n## Keeps the books\n- Reconcile" })).toBe(
        "Keeps the books"
      );
    });

    it("is empty when both the title and the instruction are empty", () => {
      expect(agentTitle({ title: "", instruction: "" })).toBe("");
    });
  });
});
