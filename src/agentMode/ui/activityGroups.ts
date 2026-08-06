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
      case "aggregate":
        // Transitional: homogeneous aggregates are subsumed by grouping and go
        // away with the `aggregate` node type. Until then, flatten them back so
        // their members can pool with neighbours of other families.
        for (const part of node.parts) run.push({ type: "action", part });
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
 * Bucket for the summary line. The vocabulary is deliberately coarse: reads and
 * edits are named because they are what users scan a turn for; everything else —
 * searches, fetches, skills, MCP calls, tools that do not exist yet — counts as
 * a command, so no new tool can ever change how the line reads. The identity
 * the line gives up is one click away in the expanded rows, and a lone call
 * never enters a group at all, so it keeps its precise row.
 */
type ActivityFamily = "read" | "edit" | "command";

function familyFor(part: ToolCallPart): ActivityFamily {
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
      return "command";
  }
}

/** Lowercase sentence fragment for one family's contribution to the line. */
function phraseFor(family: ActivityFamily, n: number): string {
  switch (family) {
    case "read":
      return `read ${pluralize(n, "file")}`;
    case "edit":
      return `edited ${pluralize(n, "file")}`;
    case "command":
      return `ran ${pluralize(n, "command")}`;
  }
}

export interface ActivitySummaryOptions {
  /**
   * Wall-clock the group spent reasoning. `kind: "thought"` parts carry no
   * timestamps, so the duration cannot be derived here — the rendering layer
   * measures it live and passes it in. Omitted or zero renders no duration.
   */
  thinkingMs?: number;
}

export interface ActivitySummary {
  /** The collapsed row's line, e.g. `Read 2 files, ran 12 commands, thought for 51s`. */
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
  const order: ActivityFamily[] = [];
  const counts = new Map<ActivityFamily, number>();
  let thoughts = 0;
  let failed = 0;

  for (const member of members) {
    if (member.type === "reasoning") {
      thoughts++;
      continue;
    }
    if (member.part.status === "failed") failed++;
    const family = familyFor(member.part);
    if (!counts.has(family)) order.push(family);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  const parts = order.map((family) => phraseFor(family, counts.get(family) ?? 0));

  const thinkingMs = options.thinkingMs ?? 0;
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
