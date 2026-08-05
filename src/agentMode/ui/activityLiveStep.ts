import type { ActivityMember } from "@/agentMode/ui/activityGroups";
import { lookupToolSummary, type ToolSummaryContext } from "@/agentMode/ui/toolSummaries";

/** Matches `AgentReasoningBlock`'s active-state wording. */
const REASONING_LABEL = "Reasoning";

/**
 * Whether the group is reasoning right now. Like the trail's own check, a
 * `thought` counts as live only while it trails the run: anything after it
 * proves the agent moved on, and no backend emits a "reasoning ended" event.
 *
 * @param members - The group's members, in stream order.
 * @param isStreaming - Whether the trail this group belongs to is still in flight.
 */
export function isReasoningActive(members: ActivityMember[], isStreaming: boolean): boolean {
  return isStreaming && members[members.length - 1]?.type === "reasoning";
}

/**
 * Label for the one step a collapsed group has in flight, or null when the
 * group is quiet. This is the only motion grouping allows: one row that swaps
 * as the agent moves on and retires when the work ends, never a list that
 * collapses under the user (see `designdocs/AGENT_TRAIL_GROUPING.md`).
 *
 * @param members - The group's members, in stream order.
 * @param isStreaming - Whether the trail this group belongs to is still in flight.
 * @param ctx - Vault base used to shorten paths in the tool's own label.
 */
export function activityLiveStep(
  members: ActivityMember[],
  isStreaming: boolean,
  ctx?: ToolSummaryContext
): string | null {
  if (!isStreaming) return null;
  if (isReasoningActive(members, isStreaming)) return REASONING_LABEL;
  // Tool calls can resolve out of order, so the trailing member is not
  // necessarily the unfinished one — take the latest that has yet to settle.
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
