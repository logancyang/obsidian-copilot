import { buildProjectContextUpdatesBlock } from "./contextUpdatesBlockBuilder";

describe("buildProjectContextUpdatesBlock", () => {
  it("returns the fixed coarse note wrapped in a project_context_updates tag", () => {
    const block = buildProjectContextUpdatesBlock();
    expect(block).toContain("<project_context_updates>");
    expect(block).toContain("</project_context_updates>");
    expect(block).toContain("re-check the declared project context before answering");
  });

  it("is a stable, source-agnostic constant (no per-path detail)", () => {
    expect(buildProjectContextUpdatesBlock()).toBe(buildProjectContextUpdatesBlock());
  });
});
