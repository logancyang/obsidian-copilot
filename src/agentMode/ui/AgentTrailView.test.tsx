import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { AgentMessagePart, TurnFileChange } from "@/agentMode/session/types";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text, miyoPaths }: { text: string; miyoPaths?: string[] }) => (
    <div data-testid="agent-md" data-miyo-paths={miyoPaths?.join("|")}>
      {text}
    </div>
  ),
}));

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (s: string) => s.trim(),
  insertAtCursor: jest.fn(),
}));

jest.mock("obsidian", () => {
  class MarkdownView {}
  return {
    MarkdownView,
    Component: class {
      load() {}
      unload() {}
      register() {}
    },
    App: class {},
    FileSystemAdapter: class {},
    WorkspaceLeaf: class {},
    Notice: class {},
    Platform: { isMobile: false },
  };
});

const { insertAtCursor } = jest.requireMock<{ insertAtCursor: jest.Mock }>("@/utils");

const text = (value: string): AgentMessagePart => ({ kind: "text", text: value });

function makeApp() {
  return { workspace: { getActiveFile: jest.fn(() => null) } } as never;
}

type TrailProps = Partial<React.ComponentProps<typeof AgentTrail>>;
type TrailApp = React.ComponentProps<typeof AgentTrail>["app"];

function trailElement(app: TrailApp, props: TrailProps) {
  return (
    <AppContext.Provider value={app}>
      <TooltipProvider>
        <AgentTrail
          parts={[text("The final answer.  ")]}
          isStreaming={false}
          turnStopReason="end_turn"
          app={app}
          {...props}
        />
      </TooltipProvider>
    </AppContext.Provider>
  );
}

function renderTrail(props: TrailProps = {}) {
  const app = props.app ?? makeApp();
  const result = render(trailElement(app, props));
  return {
    ...result,
    app,
    rerenderTrail: (next: TrailProps) => result.rerender(trailElement(app, next)),
  };
}

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

function toolCall(id: string, overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return { kind: "tool_call", id, title: id, status: "completed", ...overrides };
}

const READ_A = toolCall("r1", {
  vendorToolName: "Read",
  locations: [{ path: "notes/a.md" }],
});
const READ_B = toolCall("r2", {
  vendorToolName: "Read",
  locations: [{ path: "notes/b.md" }],
});
const LINT = toolCall("b1", {
  vendorToolName: "Bash",
  input: { command: "npm run lint" },
});

describe("AgentTrail", () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("renders both buttons under a completed message and wires each to the cleaned final text", () => {
    const { app } = renderTrail();

    expect(screen.getByTitle("Copy")).toBeTruthy();
    expect(screen.getByTitle("Insert / Replace at cursor")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Copy"));
    expect(writeText).toHaveBeenCalledWith("The final answer.");

    fireEvent.click(screen.getByTitle("Insert / Replace at cursor"));
    expect(insertAtCursor).toHaveBeenCalledWith(app, "The final answer.");
  });

  const EDITED_NOTE: TurnFileChange = {
    path: "notes/diff-demo/alpha.md",
    status: "modified",
    before: "before",
    after: "after",
    additions: 3,
    deletions: 1,
  };

  it("shows the one file a finished turn changed as a single unheaded card", () => {
    renderTrail({ fileChanges: [EDITED_NOTE] });

    expect(screen.queryByText(/Files changed/)).toBeNull();
    expect(screen.getByRole("button", { name: /alpha\.md/ })).toBeTruthy();
  });

  it("lists the files under a Files changed header when a finished turn changed several", () => {
    renderTrail({
      fileChanges: [EDITED_NOTE, { ...EDITED_NOTE, path: "notes/diff-demo/beta.md" }],
    });

    expect(screen.getByText("Files changed (2)")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /\.md/ })).toHaveLength(2);
  });

  it("hands the clicked file to the caller so it can open the diff", () => {
    const onOpenFileChange = jest.fn();
    renderTrail({ fileChanges: [EDITED_NOTE], onOpenFileChange });

    fireEvent.click(screen.getByRole("button", { name: /alpha\.md/ }));

    expect(onOpenFileChange).toHaveBeenCalledWith(EDITED_NOTE);
  });

  it("withholds the changed-files card until the turn has stopped", () => {
    renderTrail({ isStreaming: true, turnStopReason: undefined, fileChanges: [EDITED_NOTE] });

    expect(screen.queryByText(/Files changed/)).toBeNull();
  });

  it("shows no changed-files card when the turn changed nothing", () => {
    renderTrail({ fileChanges: [] });
    expect(screen.queryByText(/Files changed/)).toBeNull();

    renderTrail({ fileChanges: undefined });
    expect(screen.queryByText(/Files changed/)).toBeNull();
  });

  it("renders neither button while the message is still streaming", () => {
    renderTrail({ isStreaming: true, turnStopReason: undefined });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });

  it("shows the running duration instead of the timestamp while streaming", () => {
    renderTrail({
      isStreaming: true,
      turnStopReason: undefined,
      turnStartedAtMs: Date.now() - 24_000,
      timestamp: "2026/08/07 20:31:10",
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
  });

  it("renders neither button when the turn was cancelled", () => {
    renderTrail({ turnStopReason: "cancelled", timestamp: "2026/08/07 20:31:10" });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
    expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
  });

  it("renders neither button when the turn produced no trailing prose", () => {
    renderTrail({ parts: [{ kind: "tool_call", id: "t1", title: "Read", status: "completed" }] });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });

  it("shows the timestamp with response controls when a completed duration is unavailable", () => {
    renderTrail({ timestamp: "2026/08/07 20:31:10" });

    expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
    expect(screen.queryByText("Worked for")).toBeNull();
  });

  it("keeps research inline while showing a non-collapsible completed duration", () => {
    renderTrail({
      parts: [
        { kind: "tool_call", id: "t1", title: "Search vault", status: "completed" },
        text("The final answer."),
      ],
      turnStopReason: "end_turn",
      turnDurationMs: 138_000,
      timestamp: "2026/08/07 20:31:10",
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByText("2m 18s")).toBeTruthy();
    expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
    expect(screen.queryByRole("button", { name: /Worked for/i })).toBeNull();
    const footer = screen.getByText("Worked for").closest(".tw-justify-between");
    expect(footer?.classList.contains("tw-items-center")).toBe(true);
    expect(footer?.contains(screen.getByTitle("Copy"))).toBe(true);
    expect(footer?.contains(screen.getByTitle("Insert / Replace at cursor"))).toBe(true);
    expect(screen.getByText("The final answer.")).toBeTruthy();
    expect(screen.getByText("Search vault")).toBeTruthy();
  });

  const compaction = (
    overrides: Partial<Extract<AgentMessagePart, { kind: "compaction" }>> = {}
  ): AgentMessagePart => ({
    kind: "compaction",
    id: "c1",
    status: "completed",
    trigger: "manual",
    startedAtMs: 0,
    ...overrides,
  });

  it("renders a compaction row in line with the surrounding answer", () => {
    renderTrail({ parts: [text("Before."), compaction(), text("After.")] });

    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "Before.",
      "After.",
    ]);
  });

  it("keeps the Worked for line and copy actions on a reply that also holds an answer", () => {
    renderTrail({
      parts: [compaction({ trigger: "auto" }), text("The final answer.")],
      turnDurationMs: 138_000,
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
  });

  it.each([
    { scenario: "only a compaction", parts: [compaction()] },
    {
      scenario: "a compaction beside a hidden ToolSearch call and blank text",
      parts: [
        compaction(),
        {
          kind: "tool_call",
          id: "ts1",
          title: "ToolSearch",
          status: "completed",
          vendorToolName: "ToolSearch",
        },
        text("  "),
      ] satisfies AgentMessagePart[],
    },
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/633 hides Worked for and the copy action on a completed reply that renders $scenario",
    ({ parts }) => {
      renderTrail({
        parts,
        turnDurationMs: 138_000,
        timestamp: "2026/08/07 20:31:10",
      });

      expect(screen.getByText("Context compacted")).toBeTruthy();
      expect(screen.queryByText("Worked for")).toBeNull();
      expect(screen.queryByTitle("Copy")).toBeNull();
      expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
    }
  );

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 restores Worked for and the copy action once an answer streams into the same parts list after a compaction", () => {
    const parts: AgentMessagePart[] = [compaction({ trigger: "auto" })];
    const { rerenderTrail } = renderTrail({ parts, turnDurationMs: 138_000 });
    expect(screen.queryByTitle("Copy")).toBeNull();

    parts.push(text("The final answer."));
    rerenderTrail({ parts, turnDurationMs: 138_000 });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 shows only the compaction's own elapsed time while a compaction-only reply is running", () => {
    renderTrail({
      parts: [compaction({ status: "in_progress", startedAtMs: Date.now() - 5_000 })],
      isStreaming: true,
      turnStopReason: undefined,
      turnStartedAtMs: Date.now() - 5_000,
    });

    expect(screen.getByRole("status").textContent).toBe("Compacting conversation…");
    expect(screen.queryByText("Worked for")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 shows a failed turn's error under a reply that holds parts but no answer text", () => {
    renderTrail({
      parts: [compaction()],
      errorText: "**Error:** stream error",
      turnDurationMs: 4_000,
    });

    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.getByTestId("agent-md").textContent).toBe("**Error:** stream error");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 leaves a reply that has answer text alone, since its error text would repeat the answer", () => {
    renderTrail({
      parts: [text("Partial answer."), compaction()],
      errorText: "Partial answer.\n\n**Error:** stream error",
    });

    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "Partial answer.",
    ]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 says the turn stopped at the output limit under a reply that already has answer text, rendering the answer once", () => {
    renderTrail({
      parts: [
        text("I'll load the meeting note skill first."),
        toolCall("w1", { status: "failed" }),
      ],
      turnStopReason: "max_tokens",
    });

    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "I'll load the meeting note skill first.",
      "**Stopped early:** the model hit its output limit, so its last step may not have run. Send another message to continue.",
    ]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 says why the turn stopped at the agent's step limit or a safety stop", () => {
    const { rerenderTrail } = renderTrail({ turnStopReason: "max_turn_requests" });
    expect(screen.getAllByTestId("agent-md")[1].textContent).toBe(
      "**Stopped early:** the agent hit its step limit, so its last step may not have run. Send another message to continue."
    );

    rerenderTrail({ turnStopReason: "refusal" });
    expect(screen.getAllByTestId("agent-md")[1].textContent).toBe(
      "**Stopped early:** the model's safety system stopped it, so its last step may not have run. Send another message to continue."
    );
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 shows no stop notice for a reply that ended normally or was cancelled", () => {
    const { rerenderTrail } = renderTrail({ turnStopReason: "end_turn" });
    expect(screen.getAllByTestId("agent-md")).toHaveLength(1);

    rerenderTrail({ turnStopReason: "cancelled" });
    expect(screen.getAllByTestId("agent-md")).toHaveLength(1);
  });

  it("uses one aligned folding header for reasoning and every tool-card family", () => {
    const { container } = renderTrail({
      parts: [
        { kind: "thought", text: "Inspect the trail first." },
        text("Reasoning complete."),
        { ...READ_A, output: [{ type: "text", text: "file contents" }] },
        text("Single tool complete."),
        READ_B,
        LINT,
        text("Grouped tools complete."),
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Check nested cards" },
        }),
        { ...READ_A, id: "nested-read", parentToolCallId: "task1" },
      ],
    });

    const headers = [...container.querySelectorAll("[data-agent-activity-card-header]")];
    expect(headers).toHaveLength(4);
    expect(headers.every((header) => header.classList.contains("tw-pl-1"))).toBe(true);
    expect(headers.every((header) => header.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(container.querySelectorAll(".lucide-chevron-right")).toHaveLength(4);
  });

  it("shows progress on a childless background subagent card", () => {
    renderTrail({
      parts: [
        {
          kind: "tool_call",
          id: "launch",
          title: "Agent",
          vendorToolName: "Agent",
          status: "in_progress",
          input: { subagent_type: "Explore", description: "Analyze notes" },
          progress: {
            description: "Running Count markdown files",
            toolUses: 3,
            durationMs: 9851,
          },
        },
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    expect(screen.getByText("Running Count markdown files · 3 tools · 9s")).toBeTruthy();
  });
  const STREAMING_PARTS: AgentMessagePart[] = [
    READ_A,
    { kind: "thought", text: "still mulling it over" },
    text("Halfway there."),
    READ_B,
    { ...LINT, status: "in_progress" },
  ];

  it("shows the live row on the group at the live edge only", () => {
    renderTrail({ parts: STREAMING_PARTS, isStreaming: true, turnStopReason: undefined });

    expect(screen.getByText("Running `npm run lint`")).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
  });

  it("keeps trailing reasoning live when the streaming group is expanded", () => {
    renderTrail({
      parts: [READ_A, { kind: "thought", text: "still mulling it over" }],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: /read 1 file/i }));

    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByText("Thought for")).toBeNull();
  });

  it("does not restart a frozen thought when a hidden tool trails it (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(30_000);
      renderTrail({
        parts: [
          READ_A,
          {
            kind: "thought",
            text: "Finished reasoning",
            startedAtMs: 12_000,
            durationMs: 18_000,
          },
          toolCall("hidden", { vendorToolName: "ToolSearch", status: "in_progress" }),
        ],
        isStreaming: true,
        turnStopReason: undefined,
      });

      expect(screen.getByText("Ran 1 command, read 1 file, thought for 18s")).toBeTruthy();
      expect(screen.queryByText("Reasoning")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders a frozen standalone trailing thought as complete (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
    renderTrail({
      parts: [
        {
          kind: "plan",
          entries: [{ content: "Inspect the result", priority: "medium", status: "pending" }],
        },
        {
          kind: "thought",
          text: "Finished reasoning",
          startedAtMs: 12_000,
          durationMs: 18_000,
        },
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    expect(screen.getByText("Thought for")).toBeTruthy();
    expect(screen.getByText("18s")).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
  });

  it("renders prose between two groups at full size", () => {
    renderTrail({ parts: STREAMING_PARTS, isStreaming: true, turnStopReason: undefined });

    const prose = screen.getByText("Halfway there.");
    expect(prose.getAttribute("data-testid")).toBe("agent-md");
    expect(screen.getByText("Ran 1 command, read 1 file")).toBeTruthy();
    expect(screen.getByText("Ran 2 commands, read 1 file")).toBeTruthy();
  });

  it("keeps a group the user opened open as more parts stream into it", () => {
    const { rerenderTrail } = renderTrail({
      parts: [READ_A, LINT],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: /read 1 file/i }));
    expect(screen.getByRole("link", { name: "notes/a.md" })).toBeTruthy();

    rerenderTrail({
      parts: [READ_A, LINT, READ_B],
      isStreaming: true,
      turnStopReason: undefined,
    });

    const grown = screen.getByRole("button", { name: /read 2 files/i });
    expect(grown.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "notes/b.md" })).toBeTruthy();
  });

  it("groups a sub-agent's children too", () => {
    renderTrail({
      parts: [
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_A, parentToolCallId: "task1" },
        { ...LINT, parentToolCallId: "task1" },
      ],
    });

    fireEvent.click(screen.getByText('Explore · "Look around"'));

    expect(screen.getByText("2 tools")).toBeTruthy();
    expect(screen.getByText("Ran 2 commands, read 1 file")).toBeTruthy();
  });

  it("keeps an opened tool visible when streaming turns it into a group", () => {
    const readWithOutput = {
      ...READ_A,
      output: [{ type: "text" as const, text: "file contents" }],
    };
    const { rerenderTrail } = renderTrail({
      parts: [readWithOutput],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.getByText("file contents")).toBeTruthy();

    rerenderTrail({
      parts: [readWithOutput, LINT],
      isStreaming: true,
      turnStopReason: undefined,
    });

    const group = screen.getByRole("button", { name: /Ran 2 commands, read 1 file/ });
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("file contents")).toBeTruthy();

    fireEvent.click(group);
    expect(screen.queryByText("file contents")).toBeNull();
  });

  it("keeps nested group expansion independent from the root trail", () => {
    renderTrail({
      parts: [
        READ_A,
        LINT,
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_B, parentToolCallId: "task1" },
        {
          ...toolCall("b2", { vendorToolName: "Bash", input: { command: "npm test" } }),
          parentToolCallId: "task1",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Ran 2 commands, read 1 file/ }));
    fireEvent.click(screen.getByText('Explore · "Look around"'));

    const groups = screen.getAllByRole("button", { name: /Ran 2 commands, read 1 file/ });
    expect(groups.map((group) => group.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
  });

  it("keeps live activity inside an earlier sub-agent quiet", () => {
    renderTrail({
      parts: [
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_A, parentToolCallId: "task1" },
        {
          ...toolCall("child-command", {
            vendorToolName: "Bash",
            status: "in_progress",
            input: { command: "npm run child" },
          }),
          parentToolCallId: "task1",
        },
        text("Moved on."),
        READ_B,
        toolCall("root-command", {
          vendorToolName: "Bash",
          status: "in_progress",
          input: { command: "npm run root" },
        }),
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByText('Explore · "Look around"'));

    expect(screen.queryByText("Running `npm run child`")).toBeNull();
    expect(screen.getByText("Running `npm run root`")).toBeTruthy();
  });

  const CLAUDE_MIYO = (overrides: Partial<ToolCallPart> = {}) =>
    toolCall("miyo", {
      title: "miyo_search",
      mcpServer: "obsidian-copilot",
      vendorToolName: "miyo_search",
      input: { query: "standing desk" },
      output: [
        { type: "text", text: '{"results":[{"path":"v/a.md"},{"path":"v/b.md"}],"count":2}' },
      ],
      ...overrides,
    });
  it("renders a miyo_search call as its own card between grouped work, with its query and note count (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
    renderTrail({ parts: [READ_A, LINT, CLAUDE_MIYO(), READ_B, LINT, text("Found it.")] });

    expect(screen.getByText("Searched with Miyo")).toBeTruthy();
    expect(screen.getByText("“standing desk”")).toBeTruthy();
    expect(screen.getByText("2 notes")).toBeTruthy();
    expect(screen.getAllByText("Ran 2 commands, read 1 file")).toHaveLength(2);
  });

  it("renders a failed miyo_search call as a failed card with the error text and no badge paths (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
    renderTrail({
      parts: [
        CLAUDE_MIYO({
          status: "failed",
          output: [
            {
              type: "text",
              text: "Miyo search failed. Continue with keyword search. Details: net::ERR_CONNECTION_REFUSED",
            },
          ],
        }),
        text("See [[a]]."),
      ],
      isStreaming: false,
    });

    expect(screen.getByText("Miyo search failed")).toBeTruthy();
    expect(screen.getByText("net::ERR_CONNECTION_REFUSED")).toBeTruthy();
    expect(screen.getByTestId("agent-md").getAttribute("data-miyo-paths")).toBe("");
  });

  it("gives the answer text the note paths of a miyo_search call, as when the chat is reopened from history (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
    renderTrail({ parts: [CLAUDE_MIYO(), text("See [[a]].")], isStreaming: false });

    expect(screen.getByTestId("agent-md").getAttribute("data-miyo-paths")).toBe("v/a.md|v/b.md");
  });

  it("renders shell runs of the retired miyo-search script as ordinary command rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
    renderTrail({
      parts: [
        toolCall("load", { vendorToolName: "Skill", input: { skill: "miyo-search" } }),
        toolCall("run", {
          vendorToolName: "Bash",
          toolKind: "execute",
          input: { command: 'sh "/v/.claude/skills/miyo-search/miyo-search.sh" "standing desk"' },
          output: [{ type: "text", text: '{"results":[{"path":"v/a.md"}]}' }],
        }),
        text("Found it."),
      ],
      isStreaming: false,
    });

    expect(screen.queryByText("Searched with Miyo")).toBeNull();
    expect(screen.getByTestId("agent-md").getAttribute("data-miyo-paths")).toBe("");
    expect(screen.getByText("Ran 2 commands")).toBeTruthy();
  });
});
