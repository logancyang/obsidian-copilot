import type { ToolCallDelta } from "@/agentMode/session/types";
import { readAntigravityArtifactWrite } from "./antigravityArtifactWrites";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));

const PLAN_TEXT = "# Plan: Add a heading\n\n1. Add `## Notes` to gamma.md.\n";
const TODO_TEXT = "# Task Plan\n\n- [x] Read the note\n- [/] Add the heading\n- [ ] Check it\n";

describe("antigravityArtifactWrites", () => {
  let home: TempHome;
  let brain: string;

  beforeEach(() => {
    home = pinTempHome();
    brain = `${home.homeDir}/.gemini/antigravity-cli/brain/session-1`;
  });

  afterEach(() => home.restore());

  function writeCall(path: string, rawInput: Record<string, unknown>): ToolCallDelta {
    return {
      toolCallId: "write",
      title: `File ${path}`,
      kind: "edit",
      status: "in_progress",
      locations: [{ path }],
      rawInput: { Path: path, ...rawInput },
    };
  }

  function completed(call: ToolCallDelta, newText: string): ToolCallDelta {
    const path = call.locations?.[0]?.path ?? "";
    return { ...call, status: "completed", content: [{ type: "diff", path, newText }] };
  }

  describe("readAntigravityArtifactWrite()", () => {
    it("reads a file the agent writes to its brain folder for review as a plan, with the text it wrote", () => {
      const call = writeCall(`${brain}/add_heading_plan.md`, {
        Content: PLAN_TEXT,
        ArtifactMetadata: { RequestFeedback: true, Summary: "Plan", UserFacing: true },
      });

      expect(readAntigravityArtifactWrite(call)).toEqual({
        kind: "plan",
        plan: PLAN_TEXT,
        planFilePath: `${brain}/add_heading_plan.md`,
      });
    });

    it("reads a revised plan from the whole file text a completed edit reports, without the newline agy adds", () => {
      const call = writeCall(`${brain}/plan.md`, {
        Target: "1. Add",
        Replacement: "1. Insert",
        ArtifactMetadata: { RequestFeedback: true },
      });

      expect(readAntigravityArtifactWrite(call)).toEqual({
        kind: "plan",
        plan: undefined,
        planFilePath: `${brain}/plan.md`,
      });
      expect(readAntigravityArtifactWrite(completed(call, `${PLAN_TEXT}\n`))).toEqual({
        kind: "plan",
        plan: PLAN_TEXT,
        planFilePath: `${brain}/plan.md`,
      });
    });

    it("reads a brain-folder file of checklist items, whatever its name, as a checklist of its done, current and open items", () => {
      const todo = writeCall(`${brain}/todo.md`, {
        Content: TODO_TEXT,
        ArtifactMetadata: { RequestFeedback: false },
      });
      const taskList = writeCall(`${brain}/task_list.md`, {
        Content: "# Task List\n\n- [/] 1. Read `Spike/s7-list.md`\n",
        ArtifactMetadata: { RequestFeedback: false },
      });

      expect(readAntigravityArtifactWrite(todo)).toEqual({
        kind: "checklist",
        entries: [
          { content: "Read the note", status: "completed", priority: "medium" },
          { content: "Add the heading", status: "in_progress", priority: "medium" },
          { content: "Check it", status: "pending", priority: "medium" },
        ],
      });
      expect(readAntigravityArtifactWrite(taskList)).toEqual({
        kind: "checklist",
        entries: [
          { content: "1. Read `Spike/s7-list.md`", status: "in_progress", priority: "medium" },
        ],
      });
    });

    it("reads a checklist edit only once its completed update gives the whole file", () => {
      const call = writeCall(`${brain}/todo.md`, { Target: "- [ ]", Replacement: "- [x]" });

      expect(readAntigravityArtifactWrite(call)).toBeNull();
      expect(readAntigravityArtifactWrite(completed(call, "- [x] Check it\n\n"))).toEqual({
        kind: "checklist",
        entries: [{ content: "Check it", status: "completed", priority: "medium" }],
      });
    });

    it("leaves brain-folder files with no review request and no checklist, and writes outside the brain folder, as ordinary edits", () => {
      const walkthrough = writeCall(`${brain}/walkthrough.md`, {
        Content: "# Walkthrough\n",
        ArtifactMetadata: { RequestFeedback: false },
      });
      const vaultNote = writeCall("/vault/brain/s/todo.md", {
        Content: "- [ ] Milk\n",
        ArtifactMetadata: { RequestFeedback: true },
      });
      const otherHome = writeCall("/elsewhere/.gemini/antigravity-cli/brain/s/plan.md", {
        Content: PLAN_TEXT,
        ArtifactMetadata: { RequestFeedback: true },
      });

      expect(readAntigravityArtifactWrite(walkthrough)).toBeNull();
      expect(readAntigravityArtifactWrite(vaultNote)).toBeNull();
      expect(readAntigravityArtifactWrite(otherHome)).toBeNull();
    });
  });
});
