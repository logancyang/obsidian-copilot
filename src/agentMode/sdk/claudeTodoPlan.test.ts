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
    // A non-empty array that filters to nothing is garbage — keep the good list.
    expect(
      planUpdateFromClaudeToolUse(state, "tu2", "TodoWrite", {
        todos: [{ content: "", status: "pending" }],
      })
    ).toBeNull();
    // A real `todos: []` is a clear — emit empty entries to reset downstream.
    expect(planUpdateFromClaudeToolUse(state, "tu3", "TodoWrite", { todos: [] })).toEqual({
      sessionUpdate: "plan",
      entries: [],
    });
  });
});

describe("claudeTodoPlan — Task tools split shape", () => {
  it("accumulates TaskCreate → tool_result id binding → TaskUpdate status changes", () => {
    const state = createClaudeTaskPlanState();
    // Creates carry no id yet — nothing to show until the result binds one.
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
      // The shape real claude CLIs (>= 2.1.142) actually emit.
      "Task #1 created successfully: keep",
      [{ type: "text", text: "Task #1 created successfully: keep" }],
      // Object / JSON shapes kept for forward-compat with other CLI versions.
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
    // Real CLI result is a human string; the id is the `#N` ordinal, and the
    // echoed subject is ignored in favor of the authoritative pending subject.
    const bound = planUpdateFromClaudeToolResult(
      state,
      "tu1",
      "Task #1 created successfully: Choose theme (echoed copy)"
    );
    expect(entriesOf(bound)).toEqual([
      { content: "Choose theme", status: "pending", priority: "medium" },
    ]);
    // TaskUpdate references that same ordinal `"1"` — the link that was broken
    // when the string result couldn't be parsed into an id.
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

    // Unknown id / unmatched result: no emission, no state change.
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

    // Deleting the last entry emits an EMPTY plan so downstream clears.
    const afterLast = planUpdateFromClaudeToolUse(state, "z", "TaskUpdate", {
      taskId: "k",
      status: "deleted",
    });
    expect(entriesOf(afterLast)).toEqual([]);
  });

  it("consumes the pending TaskCreate even when its result is null/unparseable (no leak, no late bind)", () => {
    const state = createClaudeTaskPlanState();
    planUpdateFromClaudeToolUse(state, "tu", "TaskCreate", { subject: "ghost" });

    // is_error result is passed as null content by the translator → the pending
    // entry is consumed (spent) and nothing is emitted.
    expect(planUpdateFromClaudeToolResult(state, "tu", null)).toBeNull();

    // A second (stray re-delivered) result for the SAME id must NOT resurrect
    // the entry — the pending was already consumed, so even a well-formed
    // payload now no-ops instead of binding a phantom task.
    expect(
      planUpdateFromClaudeToolResult(state, "tu", { task: { id: "1", subject: "ghost" } })
    ).toBeNull();
  });

  it("drops a fully-completed group when the next topic's first TaskCreate binds", () => {
    // Official Todo lifecycle step 4: "Removed when all tasks in a group are
    // completed." A new session topic (e.g. HK guide → Japan guide) must not
    // stack its tasks onto the previous, already-finished group.
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

    // The new topic's FIRST create lands while every prior task is completed —
    // the old group is dropped, leaving only the fresh task.
    planUpdateFromClaudeToolUse(state, "jp1", "TaskCreate", { subject: "Plan Japan transit" });
    const firstJapan = planUpdateFromClaudeToolResult(
      state,
      "jp1",
      "Task #7 created successfully: Plan Japan transit"
    );
    expect(entriesOf(firstJapan)).toEqual([
      { content: "Plan Japan transit", status: "pending", priority: "medium" },
    ]);

    // The SECOND create of the same batch sees a pending task → it appends,
    // it does NOT wipe the just-started group.
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
    // The clear only fires when EVERY task is completed. While a plan is still
    // in flight (some done, some open) a freshly-added step must APPEND, not
    // wipe — completed steps stay visible as progress within the live plan.
    // (Real claude burst-creates a whole plan up front, so binds always land
    // while tasks are pending; completion only happens afterwards. This guards
    // that a genuine mid-plan addition is never mistaken for a new group.)
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

    // #2 is still in_progress → the group is NOT fully completed → append.
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
    // Simulates turn 1 creating the task and turn 2 (fresh translator, same
    // shared state) updating it by id.
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
