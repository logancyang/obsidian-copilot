import { AGENT_TODO_PLANNING_STEERING } from "@/system-prompts/agentTodoPlanningSteering";

describe("AGENT_TODO_PLANNING_STEERING", () => {
  it("is a self-contained ## section with no leading/trailing whitespace", () => {
    // Composed as its own section (joined by blank lines); stray edge whitespace would
    // double-space the seams in `composeProjectInstructions`.
    expect(AGENT_TODO_PLANNING_STEERING.startsWith("## ")).toBe(true);
    expect(AGENT_TODO_PLANNING_STEERING).toBe(AGENT_TODO_PLANNING_STEERING.trim());
  });

  // The wording below is load-bearing — see the module header. These assertions keep a
  // well-meaning future edit from re-introducing the exact failure modes it was written to
  // avoid, since the text reaches three backends and there is no other guard on it.
  it("names no vendor-specific planning tool", () => {
    // A concrete tool name makes one backend try to mimic another's API.
    expect(AGENT_TODO_PLANNING_STEERING).not.toMatch(/TodoWrite|update_plan|TaskCreate|TaskUpdate/);
  });

  it("stays threshold-style — says when to skip, never mandates a plan", () => {
    expect(AGENT_TODO_PLANNING_STEERING).toContain("**When to skip:**");
    expect(AGENT_TODO_PLANNING_STEERING.toLowerCase()).not.toContain("always");
  });

  it("keeps the user's-language and single-in-progress guardrails", () => {
    expect(AGENT_TODO_PLANNING_STEERING).toContain("user's language");
    expect(AGENT_TODO_PLANNING_STEERING).toContain("exactly one item in progress");
  });
});
