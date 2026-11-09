import type { ActivityMember } from "@/agentMode/ui/activityGroups";
import { lookupToolSummary, type ToolSummaryContext } from "@/agentMode/ui/toolSummaries";

const REASONING_LABEL = "Reasoning";

export function isReasoningActive(members: ActivityMember[], atLiveEdge: boolean): boolean {
  const trailingMember = members[members.length - 1];
  // A frozen thought can remain at the visible edge when a trailing internal
  // tool is filtered out, but restarting its clock would double-count it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  return (
    atLiveEdge &&
    trailingMember?.type === "reasoning" &&
    trailingMember.part.durationMs === undefined
  );
}

export function activityLiveStep(
  members: ActivityMember[],
  atLiveEdge: boolean,
  ctx?: ToolSummaryContext
): string | null {
  if (!atLiveEdge) return null;
  if (isReasoningActive(members, atLiveEdge)) return REASONING_LABEL;
  for (let i = members.length - 1; i >= 0; i--) {
    const member = members[i];
    if (member.type !== "action") continue;
    const status = member.part.status;
    if (status === "pending" || status === "in_progress") {
      return lookupToolSummary(member.part).collapsedLine(member.part, ctx);
    }
  }
  return null;
}
