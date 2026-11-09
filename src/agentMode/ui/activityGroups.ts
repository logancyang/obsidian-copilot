import type React from "react";
import type { App } from "obsidian";
import type { RenderNode, ThoughtPart, ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentTasksContextValue } from "@/agentMode/ui/AgentTasksContext";
import { TOOL_CARD_KINDS } from "@/agentMode/ui/toolCardKinds";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import { formatDuration } from "@/lib/duration";

export type ActivityMember =
  | { type: "action"; part: ToolCallPart }
  | { type: "reasoning"; part: ThoughtPart };

export interface ActivityGroupNode {
  type: "activityGroup";
  id: string;
  members: ActivityMember[];
}

export interface ToolCardContext {
  tasks: AgentTasksContextValue | null;
}

export interface ToolCardRenderContext extends ToolCardContext {
  app: App;
  open: boolean;
  onToggle: () => void;
  renderCall: (part: ToolCallPart) => React.ReactNode;
}

export interface ToolCardPlacement {
  joinKey: string | null;
}

export interface ToolCardKind {
  place: (part: ToolCallPart, ctx: ToolCardContext) => ToolCardPlacement | null;
  render: (members: readonly ToolCallPart[], ctx: ToolCardRenderContext) => React.ReactNode;
}

export interface ToolCardNode {
  type: "toolCard";
  kind: ToolCardKind;
  members: ToolCallPart[];
}

export type GroupedTrailNode = RenderNode | ActivityGroupNode | ToolCardNode;

const EMPTY_GROUPED_TRAIL = Object.freeze([]) as unknown as GroupedTrailNode[];

const NO_TOOL_CARD_CONTEXT: ToolCardContext = Object.freeze({ tasks: null });

function placeToolCard(
  part: ToolCallPart,
  ctx: ToolCardContext,
  kinds: readonly ToolCardKind[]
): { kind: ToolCardKind; joinKey: string | null } | null {
  for (const kind of kinds) {
    const placement = kind.place(part, ctx);
    if (placement) return { kind, joinKey: placement.joinKey };
  }
  return null;
}

export function foldActivityGroups(
  nodes: RenderNode[],
  ctx: ToolCardContext = NO_TOOL_CARD_CONTEXT,
  kinds: readonly ToolCardKind[] = TOOL_CARD_KINDS
): GroupedTrailNode[] {
  if (nodes.length === 0) return EMPTY_GROUPED_TRAIL;
  const out: GroupedTrailNode[] = [];
  let run: ActivityMember[] = [];
  let groupCount = 0;
  let openCard: { node: ToolCardNode; joinKey: string } | null = null;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]);
    } else {
      out.push({ type: "activityGroup", id: `activity-${groupCount++}`, members: run });
    }
    run = [];
  };

  // Two calls share a card only when the second's kind gives it the open card's join key before the open card ends.
  // Plain calls and thoughts fold into the activity group and leave it open; every other node ends it: a message, plan,
  // compaction, sub-agent, or another tool card. https://github.com/Brevilabs/obsidian-copilot-private/issues/793
  const endOpenCard = () => {
    openCard = null;
  };

  for (const node of nodes) {
    const call = node.type === "action" ? node.part : node.type === "subagent" ? node.parent : null;
    const placed = call && placeToolCard(call, ctx, kinds);
    if (call && placed) {
      if (openCard?.node.kind === placed.kind && openCard.joinKey === placed.joinKey) {
        openCard.node.members.push(call);
        continue;
      }
      flush();
      endOpenCard();
      const card: ToolCardNode = { type: "toolCard", kind: placed.kind, members: [call] };
      out.push(card);
      if (placed.joinKey !== null) openCard = { node: card, joinKey: placed.joinKey };
    } else if (node.type === "action" || node.type === "reasoning") {
      run.push(node);
    } else {
      flush();
      endOpenCard();
      out.push(node);
    }
  }
  flush();
  return out;
}

type FileActivityFamily = "read" | "edit";

function fileFamilyFor(part: ToolCallPart): FileActivityFamily | null {
  if (!part.mcpServer) {
    switch (part.vendorToolName) {
      case "Read":
      case "NotebookRead":
        return "read";
      case "Edit":
      case "MultiEdit":
      case "Write":
      case "NotebookEdit":
        return "edit";
    }
  }
  switch (part.toolKind) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    default:
      return null;
  }
}

function filePhraseFor(family: FileActivityFamily, n: number): string {
  switch (family) {
    case "read":
      return `read ${pluralize(n, "file")}`;
    case "edit":
      return `edited ${pluralize(n, "file")}`;
  }
}

interface FileCount {
  paths: Set<string>;
  withoutPath: number;
}

function filePathsFor(part: ToolCallPart): Set<string> {
  // Codex sends one edit tool with a diff record per file, while other
  // backends may put the same paths in `locations`.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  const paths = new Set(part.locations?.map((location) => location.path) ?? []);
  for (const output of part.output ?? []) {
    if (output.type === "diff") paths.add(output.path);
  }
  return paths;
}

export interface ActivitySummaryOptions {
  thinkingMs?: number;
}

export interface ActivitySummary {
  line: string;
  failed: number;
}

export function summarizeActivity(
  members: ActivityMember[],
  options: ActivitySummaryOptions = {}
): ActivitySummary {
  const fileOrder: FileActivityFamily[] = [];
  const fileCounts = new Map<FileActivityFamily, FileCount>();
  let commands = 0;
  let thoughts = 0;
  let completedThinkingMs = 0;
  let failed = 0;

  for (const member of members) {
    if (member.type === "reasoning") {
      thoughts++;
      completedThinkingMs += member.part.durationMs ?? 0;
      continue;
    }
    commands++;
    if (member.part.status === "failed") failed++;
    const family = fileFamilyFor(member.part);
    if (!family) continue;
    // A failed or stopped edit left the note unchanged, so it is not an edited file.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/691
    if (
      family === "edit" &&
      (member.part.status === "failed" || member.part.status === "cancelled")
    ) {
      continue;
    }
    if (!fileCounts.has(family)) {
      fileOrder.push(family);
      fileCounts.set(family, { paths: new Set(), withoutPath: 0 });
    }
    const count = fileCounts.get(family)!;
    const paths = filePathsFor(member.part);
    // Some backends classify a file tool but omit structured paths. Count the
    // call as one file instead of dropping it from the summary entirely.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
    if (paths.size === 0) count.withoutPath++;
    else for (const path of paths) count.paths.add(path);
  }

  const parts = commands > 0 ? [`ran ${pluralize(commands, "command")}`] : [];
  for (const family of fileOrder) {
    const count = fileCounts.get(family)!;
    parts.push(filePhraseFor(family, count.paths.size + count.withoutPath));
  }

  const thinkingMs = completedThinkingMs + (options.thinkingMs ?? 0);
  if (thoughts > 0) {
    if (thinkingMs >= 1000) parts.push(`thought for ${formatDuration(thinkingMs)}`);
    else if (parts.length === 0) parts.push("thought");
  }

  const line = parts.join(", ");
  return {
    line: line.length > 0 ? line.charAt(0).toUpperCase() + line.slice(1) : "Worked",
    failed,
  };
}
