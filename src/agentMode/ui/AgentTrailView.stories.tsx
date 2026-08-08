import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;

function tool(
  id: string,
  vendorToolName: string,
  overrides: Partial<Extract<AgentMessagePart, { kind: "tool_call" }>> = {}
): AgentMessagePart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status: "completed",
    vendorToolName,
    ...overrides,
  };
}

const think = (text: string): AgentMessagePart => ({ kind: "thought", text });
const say = (text: string): AgentMessagePart => ({ kind: "text", text });

/**
 * The shape a real turn takes: long runs of interleaved tool calls and
 * reasoning, split by the prose that actually answers the question. Modelled on
 * a recorded turn whose trail rendered 34 rows before grouping.
 */
const TURN: AgentMessagePart[] = [
  think("The conference is probably on the calendar rather than in a note."),
  tool("s1", "Skill", { input: { skill: "gcal" } }),
  think("The helper is not on PATH here."),
  tool("b1", "Bash", { input: { description: "Locate the gws binary" } }),
  think("Searching the calendar for anything summit-shaped."),
  tool("b2", "Bash", { input: { description: "Search calendar for summit events" } }),
  tool("b3", "Bash", { input: { description: "Check calendar auth options" } }),
  think("Two accounts are configured, so I should ask which one to read."),
  say("I found two calendar accounts on this machine. Reading the personal one first."),
  tool("q1", "AskUserQuestion", {
    input: { questions: [{ header: "Account", question: "Which calendar should I read?" }] },
  }),
  tool("b4", "Bash", { input: { description: "Fetch Aug 1–2 events with descriptions" } }),
  tool("b5", "Bash", {
    input: { description: "Re-run with the personal profile" },
    status: "failed",
  }),
  think("The first profile has no access; the second one works."),
  say("Found it — **Agentic AI Summit 2026**, August 1–2 at the Marriott. Saving it to the vault."),
  tool("e1", "Edit", { input: { file_path: "Events/Agentic AI Summit 2026.md" } }),
  say("Saved to [[Agentic AI Summit 2026]] with the schedule and the two talks you flagged."),
];

/** The same turn caught mid-flight, with its last group still working. */
const STREAMING: AgentMessagePart[] = [
  ...TURN.slice(0, 8),
  tool("b6", "Bash", {
    input: { description: "Fetch Aug 1–2 events with descriptions" },
    status: "in_progress",
  }),
];

/**
 * `AgentTrail` renders markdown, so it needs the host's real `App`. The
 * `TooltipProvider` is the story's own scaffolding: a completed turn renders
 * the Copy / Insert row, whose `MessageActionButton` expects a provider from an
 * ancestor rather than supplying its own.
 */
const TrailDemo: React.FC<{ parts: AgentMessagePart[]; isStreaming?: boolean }> = ({
  parts,
  isStreaming = false,
}) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={isStreaming ? undefined : 138_000}
        app={app}
        turnStopReason={isStreaming ? undefined : "end_turn"}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Agent Trail",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

/** Work collapses into groups; every sentence the agent wrote stays visible. */
export const GroupedTurn: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} />,
};

/** The last group shows the step in flight; earlier groups stay quiet. */
export const Streaming: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={STREAMING} isStreaming />,
};
