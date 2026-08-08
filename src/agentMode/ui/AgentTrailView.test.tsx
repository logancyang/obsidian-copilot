import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { AgentMessagePart } from "@/agentMode/session/types";

// Render `text` parts as plain text so the test doesn't pull in Obsidian's
// markdown renderer (`MarkdownRenderer.render` / `Component`).
jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-md">{text}</div>,
}));

// `insertAtCursor` is a spy (its selection→replace logic is covered by the
// `insertAtCursor` unit test in utils.test.ts); `cleanMessageForCopy` is a thin
// stand-in (real sanitization is covered by the `agentResponseText` unit test) so
// the cleaned text the buttons act on is deterministic here.
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
    // Radix tooltip portals render into Obsidian's `activeDocument` global.
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
        // Multi-word title with no vendorToolName renders verbatim as the
        // ActionCard's collapsed line (GENERIC_SUMMARY → genericToolLabel).
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
    // The trailing prose renders as the final answer.
    expect(screen.getByText("The final answer.")).toBeTruthy();
    // The research tool card renders inline (not folded behind a toggle).
    expect(screen.getByText("Search vault")).toBeTruthy();
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
  // Two groups split by prose, with the trailing group still working: the
  // shape that distinguishes "the live edge" from "an earlier group".
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
    // The earlier group ends on a thought; treating it as live would leave a
    // second, permanently spinning row behind the prose.
    expect(screen.queryByText("Reasoning")).toBeNull();
  });

  it("keeps trailing reasoning live when the streaming group is expanded", () => {
    renderTrail({
      parts: [READ_A, { kind: "thought", text: "still mulling it over" }],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: /Read 1 file/ }));

    // The expanded member must report the same in-flight state the collapsed
    // live row did — not flip to a finished "Thought for" block.
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByText("Thought for")).toBeNull();
  });

  it("renders prose between two groups at full size", () => {
    renderTrail({ parts: STREAMING_PARTS, isStreaming: true, turnStopReason: undefined });

    const prose = screen.getByText("Halfway there.");
    expect(prose.getAttribute("data-testid")).toBe("agent-md");
    // Both runs around it stay folded into their own summary rows. The first
    // group's reasoning went unmeasured (the clock only runs at the live edge),
    // so its line names the tool work alone.
    expect(screen.getByText("Read 1 file")).toBeTruthy();
    expect(screen.getByText("Read 1 file, ran 1 command")).toBeTruthy();
  });

  it("keeps a group the user opened open as more parts stream into it", () => {
    const { rerenderTrail } = renderTrail({
      parts: [READ_A, LINT],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: /Read 1 file/ }));
    expect(screen.getByText("Read notes/a.md")).toBeTruthy();

    rerenderTrail({
      parts: [READ_A, LINT, READ_B],
      isStreaming: true,
      turnStopReason: undefined,
    });

    const grown = screen.getByRole("button", { name: /Read 2 files/ });
    expect(grown.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Read notes/b.md")).toBeTruthy();
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
    expect(screen.getByText("Read 1 file, ran 1 command")).toBeTruthy();
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

    const group = screen.getByRole("button", { name: /Read 1 file, ran 1 command/ });
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

    fireEvent.click(screen.getByRole("button", { name: /Read 1 file, ran 1 command/ }));
    fireEvent.click(screen.getByText('Explore · "Look around"'));

    const groups = screen.getAllByRole("button", { name: /Read 1 file, ran 1 command/ });
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
});
