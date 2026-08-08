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

/** Every expandable activity family sharing one header and folding treatment. */
const UNIFIED_CARDS: AgentMessagePart[] = [
  think("I should inspect the source before changing it."),
  say("The reasoning row uses the same inset and disclosure treatment as the work below."),
  tool("read-1", "Read", {
    locations: [{ path: "src/agentMode/ui/AgentTrailView.tsx" }],
    output: [{ type: "text", text: "export const AgentTrail = ..." }],
  }),
  say("A single expandable tool remains its own row."),
  tool("read-2", "Read", { locations: [{ path: "src/agentMode/ui/ActionCard.tsx" }] }),
  tool("test-1", "Bash", { input: { description: "Run focused activity-card tests" } }),
  say("Consecutive work folds into a group with the same header geometry."),
  tool("delegate-1", "Task", {
    input: { subagent_type: "Explore", description: "Check nested trail cards" },
  }),
  tool("delegate-read", "Read", {
    parentToolCallId: "delegate-1",
    locations: [{ path: "src/agentMode/ui/SubAgentCard.tsx" }],
  }),
  say("Reasoning, individual tools, grouped work, and delegated work now align."),
];

/**
 * `AgentTrail` renders markdown, so it needs the host's real `App`. The
 * `TooltipProvider` is the story's own scaffolding: a completed turn renders
 * the Copy / Insert row, whose `MessageActionButton` expects a provider from an
 * ancestor rather than supplying its own.
 */
const TrailDemo: React.FC<{
  parts: AgentMessagePart[];
  isStreaming?: boolean;
  showCompletedDuration?: boolean;
}> = ({ parts, isStreaming = false, showCompletedDuration = true }) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={!isStreaming && showCompletedDuration ? 138_000 : undefined}
        timestamp="2026/08/07 20:31:10"
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

/** Reasoning and every tool-card family share one inset, chevron, and expanded rail. */
export const UnifiedCardStyles: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} />,
};

/** A restored structured turn falls back to its timestamp when no duration was persisted. */
export const CompletedWithoutDuration: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} showCompletedDuration={false} />,
};
