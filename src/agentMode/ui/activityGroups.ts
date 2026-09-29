import type { RenderNode, ThoughtPart, ToolCallPart } from "@/agentMode/ui/agentTrail";
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

export type GroupedTrailNode = RenderNode | ActivityGroupNode;

function isInteractive(part: ToolCallPart): boolean {
  // A submitted response must remain visible after its action card closes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
  if (part.userResponse) return true;
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
