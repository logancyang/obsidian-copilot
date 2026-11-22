import { buildProjectContextUpdatesBlock } from "./contextUpdatesBlockBuilder";

describe("contextUpdatesBlockBuilder", () => {
  describe("buildProjectContextUpdatesBlock()", () => {
    it("returns a project_context_updates block telling the model to re-check the declared project context", () => {
      const block = buildProjectContextUpdatesBlock();

      expect(block.startsWith("<project_context_updates>")).toBe(true);
      expect(block.endsWith("</project_context_updates>")).toBe(true);
      expect(block).toContain("re-check the declared project context before answering");
    });
  });
});
