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

function renderTrail(props: Partial<React.ComponentProps<typeof AgentTrail>> = {}) {
  const app = props.app ?? makeApp();
  const result = render(
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
  return { ...result, app };
}

describe("AgentTrail copy / insert actions", () => {
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

  it("renders neither button when the turn was cancelled", () => {
    renderTrail({ turnStopReason: "cancelled" });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });

  it("renders neither button when the turn produced no trailing prose", () => {
    renderTrail({ parts: [{ kind: "tool_call", id: "t1", title: "Read", status: "completed" }] });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });
});

describe("AgentTrail inline trail (no collapse)", () => {
  beforeEach(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  it("renders research inline with no 'Worked for' toggle on a completed research+answer turn", () => {
    renderTrail({
      parts: [
        // Multi-word title with no vendorToolName renders verbatim as the
        // ActionCard's collapsed line (GENERIC_SUMMARY → genericToolLabel).
        { kind: "tool_call", id: "t1", title: "Search vault", status: "completed" },
        text("The final answer."),
      ],
      turnStopReason: "end_turn",
    });

    // The "Worked for X" collapse is gone: the whole trail renders inline.
    expect(screen.queryByText(/Worked for/i)).toBeNull();
    // The trailing prose renders as the final answer.
    expect(screen.getByText("The final answer.")).toBeTruthy();
    // The research tool card renders inline (not folded behind a toggle).
    expect(screen.getByText("Search vault")).toBeTruthy();
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
});
