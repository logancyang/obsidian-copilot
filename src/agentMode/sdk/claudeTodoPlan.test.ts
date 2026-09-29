import {
  createClaudeTaskPlanState,
  planUpdateFromClaudeToolResult,
  planUpdateFromClaudeToolUse,
} from "./claudeTodoPlan";

function entriesOf(update: ReturnType<typeof planUpdateFromClaudeToolUse>) {
  expect(update).not.toBeNull();
  if (update?.sessionUpdate !== "plan") throw new Error("expected a plan update");
  return update.entries;
}

describe("claudeTodoPlan — TodoWrite whole-list shape", () => {
  it("converts input.todos into plan entries with stable content text", () => {
    const state = createClaudeTaskPlanState();
    const update = planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", {
      todos: [
        { content: "Brainstorm imagery", status: "in_progress", activeForm: "Brainstorming" },
        { content: "Draft haiku", status: "pending", activeForm: "Drafting" },
      ],
    });
    expect(entriesOf(update)).toEqual([
      { content: "Brainstorm imagery", status: "in_progress", priority: "medium" },
      { content: "Draft haiku", status: "pending", priority: "medium" },
    ]);
  });

  it("filters malformed items and returns null when nothing valid remains", () => {
    const state = createClaudeTaskPlanState();
    expect(
      planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", {
        todos: [{ content: "", status: "pending" }, { content: "x", status: "bogus" }, "junk"],
      })
    ).toBeNull();
    expect(planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", { todos: "nope" })).toBeNull();
  });

  it("suppresses re-emission of an identical list (streaming injection points)", () => {
    const state = createClaudeTaskPlanState();
    const input = { todos: [{ content: "a", status: "pending" }] };
    expect(planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", input)).not.toBeNull();
    expect(planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", input)).toBeNull();
  });

  it("clears the snapshot on a genuine empty list but not on all-malformed input", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "tu1", "TodoWrite", {
      todos: [{ content: "a", status: "pending" }],
    });
    expect(
      planUpdateFromClaudeToolUse(state, "tu2", "TodoWrite", {
        todos: [{ content: "", status: "pending" }],
      })
    ).toBeNull();
    expect(planUpdateFromClaudeToolUse(state, "tu3", "TodoWrite", { todos: [] })).toEqual({
      sessionUpdate: "plan",
      entries: [],
    });
  });
});

describe("claudeTodoPlan — Task tools split shape", () => {
  it("accumulates TaskCreate → tool_result id binding → TaskUpdate status changes", () => {
    const state = createClaudeTaskPlanState();
    expect(
      planUpdateFromClaudeToolUse(state, "tuA", "TaskCreate", {
        subject: "Brainstorm imagery",
        activeForm: "Brainstorming",
      })
    ).toBeNull();
    const afterBind = planUpdateFromClaudeToolResult(state, "tuA", {
      task: { id: "1", subject: "Brainstorm imagery" },
    });
    expect(entriesOf(afterBind)).toEqual([
      { content: "Brainstorm imagery", status: "pending", priority: "medium" },
    ]);

    expect(
      planUpdateFromClaudeToolUse(state, "tuB", "TaskCreate", { subject: "Draft" })
    ).toBeNull();
    planUpdateFromClaudeToolResult(state, "tuB", { task: { id: "2", subject: "Draft" } });

    const afterUpdate = planUpdateFromClaudeToolUse(state, "tuC", "TaskUpdate", {
      taskId: "1",
      status: "in_progress",
    });
    expect(entriesOf(afterUpdate)).toEqual([
      { content: "Brainstorm imagery", status: "in_progress", priority: "medium" },
      { content: "Draft", status: "pending", priority: "medium" },
    ]);
  });

  it("binds ids from every observed tool_result shape (incl. the real `Task #N` string)", () => {
    for (const content of [
      "Task #1 created successfully: keep",
      [{ type: "text", text: "Task #1 created successfully: keep" }],
      { task: { id: "k", subject: "keep" } },
      JSON.stringify({ task: { id: "k", subject: "keep" } }),
      [{ type: "text", text: JSON.stringify({ task: { id: "k", subject: "keep" } }) }],
    ]) {
      const state = createClaudeTaskPlanState();
      planUpdateFromClaudeToolUse(state, "tu", "TaskCreate", { subject: "keep" });
      const update = planUpdateFromClaudeToolResult(state, "tu", content);
      expect(entriesOf(update)).toEqual([
        { content: "keep", status: "pending", priority: "medium" },
      ]);
    }
  });

  it("binds the `#N` ordinal from the real string result and resolves TaskUpdate by it", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "tu1", "TaskCreate", { subject: "Choose theme" });
    const bound = planUpdateFromClaudeToolResult(
      state,
      "tu1",
      "Task #1 created successfully: Choose theme (echoed copy)"
    );
    expect(entriesOf(bound)).toEqual([
      { content: "Choose theme", status: "pending", priority: "medium" },
    ]);
    const updated = planUpdateFromClaudeToolUse(state, "tu2", "TaskUpdate", {
      taskId: "1",
      status: "completed",
    });
    expect(entriesOf(updated)).toEqual([
      { content: "Choose theme", status: "completed", priority: "medium" },
    ]);
  });

  it("TaskUpdate deleted removes the entry; unknown ids and unparseable results are ignored", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "a", "TaskCreate", { subject: "keep" });
    planUpdateFromClaudeToolResult(state, "a", { task: { id: "k" } });
    planUpdateFromClaudeToolUse(state, "b", "TaskCreate", { subject: "drop" });
    planUpdateFromClaudeToolResult(state, "b", { task: { id: "d" } });

    expect(
      planUpdateFromClaudeToolUse(state, "x", "TaskUpdate", {
        taskId: "ghost",
        status: "completed",
      })
    ).toBeNull();
    expect(
      planUpdateFromClaudeToolResult(state, "never-created", { task: { id: "z" } })
    ).toBeNull();

    const afterDelete = planUpdateFromClaudeToolUse(state, "y", "TaskUpdate", {
      taskId: "d",
      status: "deleted",
    });
    expect(entriesOf(afterDelete)).toEqual([
      { content: "keep", status: "pending", priority: "medium" },
    ]);

    const afterLast = planUpdateFromClaudeToolUse(state, "z", "TaskUpdate", {
      taskId: "k",
      status: "deleted",
    });
    expect(entriesOf(afterLast)).toEqual([]);
  });

  it("consumes the pending TaskCreate even when its result is null/unparseable (no leak, no late bind)", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "tu", "TaskCreate", { subject: "ghost" });

    expect(planUpdateFromClaudeToolResult(state, "tu", null)).toBeNull();

    expect(
      planUpdateFromClaudeToolResult(state, "tu", { task: { id: "1", subject: "ghost" } })
    ).toBeNull();
  });

  it("drops a fully-completed group when the next topic's first TaskCreate binds", () => {
    const state = createClaudeTaskPlanState();
    for (const [tu, id, subject] of [
      ["hk1", "1", "Plan HK transit"],
      ["hk2", "2", "Plan HK food"],
    ] as const) {
      planUpdateFromClaudeToolUse(state, tu, "TaskCreate", { subject });
      planUpdateFromClaudeToolResult(state, tu, `Task #${id} created successfully: ${subject}`);
      planUpdateFromClaudeToolUse(state, `${tu}-done`, "TaskUpdate", {
        taskId: id,
        status: "completed",
      });
    }

    planUpdateFromClaudeToolUse(state, "jp1", "TaskCreate", { subject: "Plan Japan transit" });
    const firstJapan = planUpdateFromClaudeToolResult(
      state,
      "jp1",
      "Task #7 created successfully: Plan Japan transit"
    );
    expect(entriesOf(firstJapan)).toEqual([
      { content: "Plan Japan transit", status: "pending", priority: "medium" },
    ]);

    planUpdateFromClaudeToolUse(state, "jp2", "TaskCreate", { subject: "Plan Japan food" });
    const secondJapan = planUpdateFromClaudeToolResult(
      state,
      "jp2",
      "Task #8 created successfully: Plan Japan food"
    );
    expect(entriesOf(secondJapan)).toEqual([
      { content: "Plan Japan transit", status: "pending", priority: "medium" },
      { content: "Plan Japan food", status: "pending", priority: "medium" },
    ]);
  });

  it("keeps a still-active group intact when a mid-plan TaskCreate binds", () => {
    const state = createClaudeTaskPlanState();
    for (const [tu, id, subject] of [
      ["c1", "1", "Outline"],
      ["c2", "2", "Draft"],
    ] as const) {
      planUpdateFromClaudeToolUse(state, tu, "TaskCreate", { subject });
      planUpdateFromClaudeToolResult(state, tu, `Task #${id} created successfully: ${subject}`);
    }
    planUpdateFromClaudeToolUse(state, "c1-done", "TaskUpdate", {
      taskId: "1",
      status: "completed",
    });
    planUpdateFromClaudeToolUse(state, "c2-go", "TaskUpdate", {
      taskId: "2",
      status: "in_progress",
    });

    planUpdateFromClaudeToolUse(state, "c3", "TaskCreate", { subject: "Polish" });
    const update = planUpdateFromClaudeToolResult(
      state,
      "c3",
      "Task #3 created successfully: Polish"
    );
    expect(entriesOf(update)).toEqual([
      { content: "Outline", status: "completed", priority: "medium" },
      { content: "Draft", status: "in_progress", priority: "medium" },
      { content: "Polish", status: "pending", priority: "medium" },
    ]);
  });

  it("survives across translator generations — the state is session-lived", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "t1", "TaskCreate", { subject: "step" });
    planUpdateFromClaudeToolResult(state, "t1", { task: { id: "42" } });
    const turn2 = planUpdateFromClaudeToolUse(state, "t2", "TaskUpdate", {
      taskId: "42",
      status: "completed",
    });
    expect(entriesOf(turn2)).toEqual([
      { content: "step", status: "completed", priority: "medium" },
    ]);
  });
});
