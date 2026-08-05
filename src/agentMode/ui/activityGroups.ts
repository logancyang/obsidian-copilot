import type { RenderNode, ThoughtPart, ToolCallPart } from "@/agentMode/ui/agentTrail";
import { humanizeToolName, pluralize } from "@/agentMode/ui/toolSummaries";
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
  return name === "AskUserQuestion" || name === "ExitPlanMode" || name === "EnterPlanMode";
}

/**
 * Fold runs of consecutive tool calls and reasoning into activity groups. A run
 * of a single member is left as the plain node it already was, so one `Read`
 * never gains group chrome.
 *
 * @param nodes - The trail as built by `buildAgentTrail`, in stream order.
 */
export function foldActivityGroups(nodes: RenderNode[]): GroupedTrailNode[] {
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
 * Bucket key for the summary line. Recognized tools share a bucket so a `Write`
 * and an `Edit` read as one phrase; everything else keys on its own identity,
 * because real sessions lean on tools with no built-in summary and pooling them
 * produces an uninformative "made 16 tool calls".
 */
function familyKey(part: ToolCallPart): string {
  if (part.mcpServer) return `mcp:${part.mcpServer}`;
  switch (part.vendorToolName) {
    case "Read":
    case "NotebookRead":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "edit";
    case "Grep":
    case "Glob":
    case "WebSearch":
      return "search";
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "run";
    case "WebFetch":
      return "fetch";
    case "LS":
      return "list";
    case "TodoWrite":
      return "todo";
    case "Skill":
      return "skill";
  }
  switch (part.toolKind) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "search":
      return "search";
    case "execute":
      return "run";
    case "fetch":
      return "fetch";
  }
  return part.vendorToolName ? `tool:${part.vendorToolName}` : "other";
}

/** Lowercase sentence fragment for one family's contribution to the line. */
function phraseFor(key: string, n: number): string {
  if (key.startsWith("mcp:")) return `${key.slice(4)} · ${pluralize(n, "call")}`;
  if (key.startsWith("tool:")) {
    // `humanizeToolName` capitalizes for a standalone label; a phrase joins
    // mid-line, so it starts lowercase and `summarizeActivity` capitalizes the
    // line's first character.
    const name = humanizeToolName(key.slice(5)).toLowerCase();
    return n === 1 ? `ran ${name}` : `${name} ×${n}`;
  }
  switch (key) {
    case "read":
      return `read ${pluralize(n, "file")}`;
    case "edit":
      return `edited ${pluralize(n, "file")}`;
    case "search":
      return `ran ${pluralize(n, "search", "searches")}`;
    case "run":
      return `ran ${pluralize(n, "command")}`;
    case "fetch":
      return `fetched ${pluralize(n, "URL")}`;
    case "list":
      return `listed ${pluralize(n, "folder")}`;
    case "todo":
      return "updated the task list";
    case "skill":
      return `ran ${pluralize(n, "skill")}`;
    default:
      return `made ${pluralize(n, "tool call")}`;
  }
}

/**
 * "Ran 1 skill, ran 12 commands" reads as two facts; dropping the repeat makes
 * it one. Only an immediately repeated verb is dropped, so a later phrase that
 * happens to share the verb of an earlier non-adjacent one keeps it.
 */
function dropRepeatedVerbs(phrases: string[]): string[] {
  let previousVerb = "";
  return phrases.map((phrase) => {
    const verb = phrase.slice(0, phrase.indexOf(" "));
    const repeated = verb.length > 0 && verb === previousVerb;
    previousVerb = verb;
    return repeated ? phrase.slice(verb.length + 1) : phrase;
  });
}

export interface ActivitySummaryOptions {
  /**
   * Wall-clock the group spent reasoning. `kind: "thought"` parts carry no
   * timestamps, so the duration cannot be derived here — the rendering layer
   * measures it live and passes it in. Omitted or zero renders no duration.
   */
  thinkingMs?: number;
  /** Families named before the rest elide to `+N more`. Defaults to 3. */
  maxPhrases?: number;
}

export interface ActivitySummary {
  /** The collapsed row's line, e.g. `Ran 1 skill, 12 commands, thought for 51s`. */
  line: string;
  /** Members that failed, surfaced by the card as a badge. */
  failed: number;
}

const DEFAULT_MAX_PHRASES = 3;

/**
 * Build the collapsed summary line for an activity group: what the agent did,
 * pooled by tool family in first-appearance order.
 *
 * @param members - The group's tool calls and reasoning, in stream order.
 * @param options - Measured reasoning time and how many families to name.
 */
export function summarizeActivity(
  members: ActivityMember[],
  options: ActivitySummaryOptions = {}
): ActivitySummary {
  const maxPhrases = options.maxPhrases ?? DEFAULT_MAX_PHRASES;
  const order: string[] = [];
  const counts = new Map<string, number>();
  let thoughts = 0;
  let failed = 0;

  for (const member of members) {
    if (member.type === "reasoning") {
      thoughts++;
      continue;
    }
    if (member.part.status === "failed") failed++;
    const key = familyKey(member.part);
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const phrases = order.map((key) => phraseFor(key, counts.get(key) ?? 0));
  const named = dropRepeatedVerbs(phrases.slice(0, maxPhrases));
  const elided = phrases.length - named.length;
  const parts = elided > 0 ? [...named, `+${elided} more`] : named;

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
