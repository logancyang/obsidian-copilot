import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart, StopReason, TurnFileChange } from "@/agentMode/session/types";
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

const STREAMING: AgentMessagePart[] = [
  ...TURN.slice(0, 8),
  tool("b6", "Bash", {
    input: { description: "Fetch Aug 1–2 events with descriptions" },
    status: "in_progress",
  }),
];

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

const FAILED_FILE_CHANGES: AgentMessagePart[] = [
  say("The edit was denied, so the card says the note was not edited."),
  tool("failed-edit", "Edit", { status: "failed", input: { file_path: "Projects/plan.md" } }),
  say("A denied write with no diff says the note was not edited."),
  tool("failed-write", "Write", {
    status: "failed",
    input: { file_path: "Projects/notes.md", content: "# Notes\n" },
    output: [{ type: "text", text: "User declined" }],
  }),
  say("A denied delete says the note was not deleted."),
  tool("failed-delete", "Delete", {
    status: "failed",
    toolKind: "delete",
    input: { filePath: "Archive/old.md" },
  }),
  say("A failed shell command still ran, so its label is unchanged."),
  tool("failed-bash", "Bash", { status: "failed", input: { command: "npm test" } }),
  say("A completed edit keeps its past-tense label."),
  tool("done-edit", "Edit", { input: { file_path: "Projects/plan.md" } }),
];

type ToolCallOverrides = Partial<Extract<AgentMessagePart, { kind: "tool_call" }>>;

const MIYO_QUERY = "back pain standing desk";
const MIYO_ERROR =
  "Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: net::ERR_CONNECTION_REFUSED";
const miyoResults = (paths: string[]): ToolCallOverrides["output"] => [
  { type: "text", text: JSON.stringify({ results: paths.map((path) => ({ path })) }) },
];
const MIYO_NOTES = miyoResults(["notes/Standing desk setup.md", "notes/Untitled 3.md"]);

const claudeMiyo = (overrides: ToolCallOverrides = {}, query = MIYO_QUERY): AgentMessagePart => ({
  kind: "tool_call",
  id: "miyo-run",
  title: "miyo_search",
  status: "completed",
  mcpServer: "obsidian-copilot",
  vendorToolName: "miyo_search",
  input: { query },
  ...overrides,
});

const MIYO_FOLLOW_UP: AgentMessagePart[] = [
  tool("grep-1", "Grep", { input: { pattern: "standing desk|back pain" } }),
  tool("read-1", "Read", { locations: [{ path: "notes/Standing desk setup.md" }] }),
  say("You wrote that a monitor arm and a sit-stand rhythm fixed it. See [[Standing desk setup]]."),
];

const MIYO_SEARCH: AgentMessagePart[] = [claudeMiyo({ output: MIYO_NOTES }), ...MIYO_FOLLOW_UP];

const MIYO_LONG_QUERY =
  "what did I decide about the migration plan for the shared calendar service and who owns the rollout checklist";

const MIYO_SEARCH_LONG_QUERY: AgentMessagePart[] = [
  claudeMiyo({ output: MIYO_NOTES }, MIYO_LONG_QUERY),
  say("You decided to move the rollout to the platform team. See [[Standing desk setup]]."),
];

const MIYO_LINK_NOTES: Record<string, string> = {
  "Standing desk setup": "notes/Standing desk setup.md",
  "Untitled 3": "notes/Untitled 3.md",
  "Reading list": "notes/Reading list.md",
  "Trip planning": "notes/Trip planning.md",
};

const MIYO_LINKS: AgentMessagePart[] = [
  claudeMiyo({ output: MIYO_NOTES }),
  tool("grep-1", "Grep", { input: { pattern: "ZX-4471" } }),
  say(
    "Miyo found [[Standing desk setup]] (see [[Standing desk setup#Fixes]]) and your scratch note, [[Untitled 3|desk scratchpad]]. A keyword search added [[Reading list]] and [Trip planning](notes/Trip%20planning.md)."
  ),
];

const MIYO_SEARCH_RUNNING: AgentMessagePart[] = [claudeMiyo({ status: "in_progress" })];

const MIYO_SEARCH_FAILED: AgentMessagePart[] = [
  claudeMiyo({ status: "failed", output: [{ type: "text", text: MIYO_ERROR }] }),
  say("Miyo is not running, so I could not search your notes. Open Miyo and ask again."),
];

type CompactionOverrides = Partial<Extract<AgentMessagePart, { kind: "compaction" }>>;

const compaction = (overrides: CompactionOverrides = {}): AgentMessagePart => ({
  kind: "compaction",
  id: "compaction-1",
  status: "completed",
  trigger: "manual",
  startedAtMs: Date.now() - 12_000,
  ...overrides,
});

const TrailDemo: React.FC<{
  parts: AgentMessagePart[];
  isStreaming?: boolean;
  showCompletedDuration?: boolean;
  fileChanges?: TurnFileChange[];
  linkNotes?: Record<string, string>;
  stopReason?: StopReason;
}> = ({
  parts,
  isStreaming = false,
  showCompletedDuration = true,
  fileChanges,
  linkNotes,
  stopReason = "end_turn",
}) => {
  const contextApp = useApp();
  const app = linkNotes
    ? Object.create(contextApp, {
        vault: { value: Object.create(contextApp.vault, { getName: { value: () => "step-2" } }) },
        metadataCache: {
          value: {
            getFirstLinkpathDest: (linkpath: string) => {
              const path = linkNotes[linkpath] ?? linkpath;
              return Object.values(linkNotes).includes(path) ? { path } : null;
            },
          },
        },
      })
    : contextApp;
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={!isStreaming && showCompletedDuration ? 138_000 : undefined}
        timestamp="2026/08/07 20:31:10"
        app={app}
        turnStopReason={isStreaming ? undefined : stopReason}
        fileChanges={fileChanges}
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

export const GroupedTurn: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} />,
};

export const Streaming: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={STREAMING} isStreaming />,
};

export const UnifiedCardStyles: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} />,
};

export const FailedFileChanges: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={FAILED_FILE_CHANGES} />,
};

export const MiyoSearch: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={MIYO_SEARCH} />,
};

export const MiyoSearchLongQuery: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={MIYO_SEARCH_LONG_QUERY} />,
};

export const MiyoLinkBadges: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={MIYO_LINKS} linkNotes={MIYO_LINK_NOTES} />,
};

export const MiyoSearchRunning: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={MIYO_SEARCH_RUNNING} isStreaming />,
};

export const MiyoSearchFailed: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={MIYO_SEARCH_FAILED} />,
};

export const StoppedAtOutputLimit: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("I'll load the meeting note skill first."),
        tool("s1", "Skill", { input: { skill: "meeting-note" } }),
        tool("r1", "Read", { locations: [{ path: "Meetings/2026-10-12 Weekly sync.md" }] }),
        tool("w1", "Write", {
          toolKind: "edit",
          status: "failed",
          input: { file_path: "Meetings/2026-10-19 Weekly sync.md" },
        }),
      ]}
      stopReason="max_tokens"
    />
  ),
};

export const CompletedWithoutDuration: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} showCompletedDuration={false} />,
};

const EDITED_FILES: TurnFileChange[] = [
  {
    path: "Events/Agentic AI Summit 2026.md",
    status: "created",
    before: null,
    after: "after\n",
    additions: 42,
    deletions: 0,
  },
  {
    path: "Daily/2026-08-07.md",
    status: "modified",
    before: "before\n",
    after: "after\n",
    additions: 3,
    deletions: 1,
  },
];

export const WithFilesChanged: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} fileChanges={EDITED_FILES} />,
};

export const CompactionRunningManual: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction({ status: "in_progress" })]} isStreaming />,
};

export const CompactionRunningAuto: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("Reading the remaining notes before I summarize them."),
        compaction({ status: "in_progress", trigger: "auto" }),
      ]}
      isStreaming
    />
  ),
};

export const CompactionCompletedWithTokens: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ preTokens: 182_340, postTokens: 24_100 })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCompletedWithoutTokens: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction()]} showCompletedDuration={false} />,
};

export const CompactionCompletedAutomatically: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        tool("b1", "Bash", { input: { description: "Search the vault" } }),
        tool("b2", "Bash", { input: { description: "Read the matching notes" } }),
        compaction({ trigger: "auto", preTokens: 910_000, postTokens: 31_000 }),
        tool("b3", "Bash", { input: { description: "Draft the summary" } }),
        tool("b4", "Bash", { input: { description: "Save it to the vault" } }),
        say("Saved the summary to [[Weekly review]]."),
      ]}
    />
  ),
};

export const CompactionFailed: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ status: "failed", error: "The summarization request timed out." })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCancelled: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "cancelled" })]} showCompletedDuration={false} />
  ),
};

export const CompactionSkipped: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "skipped" })]} showCompletedDuration={false} />
  ),
};
