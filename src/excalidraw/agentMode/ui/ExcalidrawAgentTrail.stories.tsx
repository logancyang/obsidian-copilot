import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;
type ToolCallOverrides = Partial<Extract<AgentMessagePart, { kind: "tool_call" }>>;

const DRAWING = "Incidents/Investigation playbook.excalidraw.md";

function tool(
  id: string,
  vendorToolName: string,
  overrides: ToolCallOverrides = {}
): AgentMessagePart {
  return { kind: "tool_call", id, title: id, status: "completed", vendorToolName, ...overrides };
}

const excalidraw = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  overrides: ToolCallOverrides = {}
): AgentMessagePart => tool(id, name, { mcpServer: "obsidian-copilot", input, ...overrides });

const say = (text: string): AgentMessagePart => ({ kind: "text", text });

const DRAW: AgentMessagePart[] = [
  tool("glob-1", "Glob", { input: { pattern: "**/Investigation playbook*" } }),
  tool("read-1", "Read", { locations: [{ path: "Incidents/Investigation playbook.md" }] }),
  excalidraw("write-1", "excalidraw_write", { path: DRAWING, elements: [] }),
  tool("edit-1", "Edit", { locations: [{ path: "Incidents/Investigation playbook.md" }] }),
  excalidraw("render-1", "excalidraw_render", { path: DRAWING }),
  say(
    "I drew the four steps of [[Investigation playbook]] as a top-to-bottom flowchart and added it to the top of that note."
  ),
];

const DRAWING_NOW: AgentMessagePart[] = [
  tool("read-1", "Read", { locations: [{ path: "Incidents/Investigation playbook.md" }] }),
  excalidraw(
    "write-1",
    "excalidraw_write",
    { path: DRAWING, elements: [] },
    { status: "in_progress" }
  ),
];

const RETRIED: AgentMessagePart[] = [
  excalidraw("read-1", "excalidraw_read", { path: "Boards/Sprint 14 board.excalidraw.md" }),
  excalidraw(
    "write-1",
    "excalidraw_write",
    { path: "Boards/Sprint 14 board.excalidraw.md", operations: [] },
    {
      status: "failed",
      output: [{ type: "text", text: "No change made to Boards/Sprint 14 board.excalidraw.md." }],
    }
  ),
  excalidraw("write-2", "excalidraw_write", {
    path: "Boards/Sprint 14 board.excalidraw.md",
    operations: [],
  }),
  excalidraw("render-1", "excalidraw_render", { path: "Boards/Sprint 14 board.excalidraw.md" }),
  say("I moved the checkout bug card to Done and added a Blocked badge to the export ticket."),
];

const BOARD = "Boards/Launch board.excalidraw.md";

const FIX_LOOP: AgentMessagePart[] = [
  say("The plugin rejected labels on the frames, so I'm retrying without them."),
  excalidraw("write-1", "excalidraw_write", { path: BOARD, elements: [] }),
  excalidraw(
    "write-2",
    "excalidraw_write",
    { path: BOARD, operations: [] },
    {
      status: "failed",
      output: [
        {
          type: "text",
          text: "No change made to Boards/Launch board.excalidraw.md: INVALID_INPUT: Unsupported field; use a trusted EA script for advanced relationships or metadata.",
        },
      ],
    }
  ),
  excalidraw("write-3", "excalidraw_write", { path: BOARD, operations: [] }),
  excalidraw("render-1", "excalidraw_render", { path: BOARD }),
  excalidraw("write-4", "excalidraw_write", { path: BOARD, operations: [] }),
  tool("read-1", "Read", { locations: [{ path: BOARD }] }),
  excalidraw("write-5", "excalidraw_write", { path: BOARD, operations: [] }),
  tool("edit-1", "Edit", { locations: [{ path: BOARD }] }),
  excalidraw("write-6", "excalidraw_write", { path: BOARD, operations: [] }),
  tool("bash-1", "Bash", { input: { command: "head -5 'Boards/Launch board.excalidraw.md'" } }),
  say("The board is built and checked; adding it to the note now."),
];

const QUESTION: AgentMessagePart[] = [
  tool("read-1", "Read", { locations: [{ path: "Architecture/Order platform.md" }] }),
  excalidraw("read-2", "excalidraw_read", { path: "Diagrams/Order platform.excalidraw.md" }),
  say(
    "Web and mobile orders go through the API gateway, which routes to the Auth, Cart and Checkout services. Checkout writes to the Orders DB and publishes an event that feeds email and analytics."
  ),
];

const ExcalidrawTrailDemo: React.FC<{ parts: AgentMessagePart[]; isStreaming?: boolean }> = ({
  parts,
  isStreaming = false,
}) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 18_000 : undefined}
        turnDurationMs={isStreaming ? undefined : 25_000}
        timestamp="2026/10/29 19:48:25"
        app={app}
        turnStopReason={isStreaming ? undefined : "end_turn"}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Agent Trail with Excalidraw",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

export const DrewDiagram: StoryObj<AgentTrailProps> = {
  render: () => <ExcalidrawTrailDemo parts={DRAW} />,
};

export const DrawingInProgress: StoryObj<AgentTrailProps> = {
  render: () => <ExcalidrawTrailDemo parts={DRAWING_NOW} isStreaming />,
};

export const EditAfterRetry: StoryObj<AgentTrailProps> = {
  render: () => <ExcalidrawTrailDemo parts={RETRIED} />,
};

export const WriteRenderFixLoop: StoryObj<AgentTrailProps> = {
  render: () => <ExcalidrawTrailDemo parts={FIX_LOOP} />,
};

export const AnsweredFromDrawing: StoryObj<AgentTrailProps> = {
  render: () => <ExcalidrawTrailDemo parts={QUESTION} />,
};
