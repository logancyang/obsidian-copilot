import type { RenderNode, ThoughtPart, ToolCallPart } from "@/agentMode/ui/agentTrail";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import { formatDuration } from "@/lib/duration";

/**
 * One unit of work inside an activity group — a tool call the agent made or a
 * block of reasoning it produced. Sub-agent launches are deliberately absent:
 * they break a group rather than joining one.
 */
export type ActivityMember =
  | { type: "action"; part: ToolCallPart }
  | { type: "reasoning"; part: ThoughtPart };

/**
 * A run of consecutive tool calls and reasoning blocks, collapsed behind one
 * summary line. See `designdocs/AGENT_TRAIL_GROUPING.md` for what breaks a run
 * and why.
 */
export interface ActivityGroupNode {
  type: "activityGroup";
  /**
   * Position of this group among the trail's groups. Parts are append-only, so
   * a group's position never changes once it exists and appending a member
   * leaves the id alone — which is what lets the UI keep an opened group open
   * while work streams into it.
   */
  id: string;
  members: ActivityMember[];
}

/** The trail after grouping: every `RenderNode`, plus collapsed activity runs. */
export type GroupedTrailNode = RenderNode | ActivityGroupNode;

/** Tool calls that own an interactive surface and must stay visible. */
function isInteractive(part: ToolCallPart): boolean {
  if (part.mcpServer) return false;
  const name = part.vendorToolName;
  return (
    part.toolKind === "switch_mode" ||
    name === "AskUserQuestion" ||
    name === "ExitPlanMode" ||
    name === "EnterPlanMode"
  );
}

const EMPTY_GROUPED_TRAIL = Object.freeze([]) as unknown as GroupedTrailNode[];

/**
 * Fold runs of consecutive tool calls and reasoning into activity groups. A run
 * of a single member is left as the plain node it already was, so one `Read`
 * never gains group chrome.
 *
 * @param nodes - The trail as built by `buildAgentTrail`, in stream order.
 */
export function foldActivityGroups(nodes: RenderNode[]): GroupedTrailNode[] {
  if (nodes.length === 0) return EMPTY_GROUPED_TRAIL;
  const out: GroupedTrailNode[] = [];
  let run: ActivityMember[] = [];
  let groupCount = 0;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]);
    } else {
      out.push({ type: "activityGroup", id: `activity-${groupCount++}`, members: run });
    }
    run = [];
  };

  for (const node of nodes) {
    switch (node.type) {
      case "reasoning":
        run.push(node);
        break;
      case "action":
        if (isInteractive(node.part)) {
          flush();
          out.push(node);
        } else {
          run.push(node);
        }
        break;
      default:
        flush();
        out.push(node);
    }
  }
  flush();
  return out;
}

/**
 * File-specific work supplements the total command count. Every action remains
 * a command, while reads and edits add the file totals users scan a turn for.
 */
type FileActivityFamily = "read" | "edit";

function fileFamilyFor(part: ToolCallPart): FileActivityFamily | null {
  // An MCP tool whose bare name collides with a native one (e.g.
  // `mcp__srv__read`) must not masquerade as it; only the ACP `toolKind` —
  // a semantic classification, not a name — can vouch for an MCP call.
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

/** Lowercase sentence fragment for one file family's contribution to the line. */
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
  /**
   * Elapsed time for the one reasoning block still in flight. Completed
   * blocks carry their frozen durations in `members`.
   */
  thinkingMs?: number;
}

export interface ActivitySummary {
  /** The collapsed row's line, e.g. `Ran 12 commands, read 2 files, thought for 51s`. */
  line: string;
  /** Members that failed, surfaced by the card as a badge. */
  failed: number;
}

/**
 * Build the collapsed summary line for an activity group: what the agent did,
 * pooled by family in first-appearance order.
 *
 * @param members - The group's tool calls and reasoning, in stream order.
 * @param options - Measured reasoning time.
 */
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
