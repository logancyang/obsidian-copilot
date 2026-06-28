import { buildProjectContextBlock } from "@/context/manifestBuilder";
import { PROJECT_OUTPUTS_DIRNAME } from "@/projects/constants";
import {
  BUILTIN_PROJECT_SYSTEM_PROMPT,
  composeProjectInstructions,
  getComposedProjectInstructions,
  PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING,
} from "@/projects/projectSystemPrompt";
import { ProjectFileRecord } from "@/projects/type";
import { AGENT_TODO_PLANNING_STEERING } from "@/system-prompts/agentTodoPlanningSteering";

// The program-authored built-in prefix every composition carries: workspace policy followed by
// the todo-planning steering, joined by the same blank line the user body uses.
const BUILTIN_PREFIX = `${BUILTIN_PROJECT_SYSTEM_PROMPT}\n\n${AGENT_TODO_PLANNING_STEERING}`;

function recordWith(systemPrompt: unknown): ProjectFileRecord {
  return {
    project: { id: "p1", name: "Foo", systemPrompt },
    filePath: "copilot-projects/Foo/project.md",
    folderName: "Foo",
  } as unknown as ProjectFileRecord;
}

describe("BUILTIN_PROJECT_SYSTEM_PROMPT", () => {
  it("names the configured outputs folder and carries its own heading", () => {
    expect(BUILTIN_PROJECT_SYSTEM_PROMPT).toContain(`${PROJECT_OUTPUTS_DIRNAME}/`);
    expect(BUILTIN_PROJECT_SYSTEM_PROMPT.startsWith("## ")).toBe(true);
    // The default-only-cwd rule must surface the opt-in exceptions, not a blanket ban — else a
    // project's configured context sources (handed to backends as additionalDirectories) look
    // forbidden.
    expect(BUILTIN_PROJECT_SYSTEM_PROMPT).toContain("configured context sources");
  });

  it("has no leading/trailing whitespace", () => {
    expect(BUILTIN_PROJECT_SYSTEM_PROMPT).toBe(BUILTIN_PROJECT_SYSTEM_PROMPT.trim());
  });

  it("points the read carve-out at the same tag the manifest actually emits", () => {
    // The read carve-out tells the agent to read paths listed in the `<project_context>` block.
    // That tag is hardcoded in both this prompt and the manifest builder; if the builder ever
    // renames it, the opt-in instruction silently dangles and the off-vault-cache regression
    // returns (the agent stops reading materialized snapshots). Pin both to one literal.
    const tag = "<project_context>";
    const block = buildProjectContextBlock({
      folders: [],
      notes: [],
      extensions: [],
      tags: [],
      webUrls: [],
      youtubeUrls: [],
      materialized: [],
    });
    expect(block).toContain(tag);
    expect(BUILTIN_PROJECT_SYSTEM_PROMPT).toContain(tag);
  });
});

describe("composeProjectInstructions", () => {
  it("returns the built-in prefix alone when there is no user body", () => {
    expect(composeProjectInstructions("")).toBe(BUILTIN_PREFIX);
  });

  it("treats a whitespace-only user body as empty", () => {
    expect(composeProjectInstructions("   \n\t ")).toBe(BUILTIN_PREFIX);
  });

  it("carries the todo-planning steering as its own ## section after the workspace policy", () => {
    // Project-scoped on purpose: the section lives here, never in the global prompt, so the
    // no-project prompt stays byte-identical. Its own `## ` heading keeps it a distinct section.
    expect(AGENT_TODO_PLANNING_STEERING.startsWith("## ")).toBe(true);
    expect(composeProjectInstructions("")).toBe(
      `${BUILTIN_PROJECT_SYSTEM_PROMPT}\n\n${AGENT_TODO_PLANNING_STEERING}`
    );
  });

  it("partitions built-ins and user body into parallel ## sections, byte-exact", () => {
    const out = composeProjectInstructions("Be concise.");
    expect(out).toBe(`${BUILTIN_PREFIX}\n\n${PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING}\n\nBe concise.`);
  });

  it("preserves a non-blank user body untouched (no trimming)", () => {
    // project.md parsing keeps the body's leading whitespace (trimStart: false); composing must
    // not strip it — e.g. an indented code block at the very start of the instructions.
    const body = "    indented code block\nplain line  ";
    expect(composeProjectInstructions(body)).toBe(
      `${BUILTIN_PREFIX}\n\n${PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING}\n\n${body}`
    );
  });
});

describe("getComposedProjectInstructions", () => {
  it("composes from a record's systemPrompt", () => {
    expect(getComposedProjectInstructions(recordWith("Cite sources."))).toBe(
      `${BUILTIN_PREFIX}\n\n${PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING}\n\nCite sources.`
    );
  });

  it("falls back to the built-in prefix when systemPrompt is missing", () => {
    expect(getComposedProjectInstructions(recordWith(undefined))).toBe(BUILTIN_PREFIX);
  });
});
