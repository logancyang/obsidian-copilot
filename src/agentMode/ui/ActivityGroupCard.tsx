import React from "react";
import { Layers, Loader2, type LucideIcon } from "lucide-react";
import {
  summarizeActivity,
  type ActivityGroupNode,
  type ActivityMember,
} from "@/agentMode/ui/activityGroups";
import { pickToolIcon } from "@/agentMode/ui/toolIcons";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

export interface ActivityGroupCardProps {
  group: ActivityGroupNode;
  /**
   * Live elapsed time for the trailing reasoning span. Completed spans keep
   * their duration on the thought parts, while the trail owns the active clock.
   */
  thinkingMs?: number;
  /**
   * Whether the body is showing. Fully controlled: a group must stay open
   * across streaming updates, which only works if the owner of the trail holds
   * this state.
   */
  open: boolean;
  onToggle: () => void;
  /**
   * Renders one member. Injected rather than imported so this file stays
   * unaware of the concrete cards the trail dispatches to.
   */
  renderMember: (member: ActivityMember, key: string | number) => React.ReactNode;
  /**
   * Transient row for the step currently in flight, shown under the summary
   * line while the group is collapsed. When the group is open the live member
   * is already visible in the body, so the row would only duplicate it.
   */
  liveStep?: React.ReactNode;
}

/**
 * One collapsed run of the agent's tool calls and reasoning, summarized as a
 * single line the user can open. Groups are born collapsed and never close
 * themselves, so nothing the user is mid-read disappears; see
 * `designdocs/AGENT_TRAIL_GROUPING.md`.
 */
export const ActivityGroupCard: React.FC<ActivityGroupCardProps> = ({
  group,
  thinkingMs,
  open,
  onToggle,
  renderMember,
  liveStep,
}) => {
  const summary = summarizeActivity(group.members, { thinkingMs });
  const Icon = groupIcon(group.members);
  const isProcessing = group.members.some(
    (m) => m.type === "action" && (m.part.status === "pending" || m.part.status === "in_progress")
  );

  return (
    <AgentActivityCard
      icon={Icon}
      label={summary.line}
      trailing={
        <>
          {summary.failed > 0 ? (
            <span className="tw-shrink-0 tw-text-xs tw-text-muted">{summary.failed} failed</span>
          ) : null}
          {isProcessing ? (
            <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />
          ) : null}
        </>
      }
      secondary={!open ? liveStep : undefined}
      expandable
      open={open}
      onToggle={onToggle}
    >
      {group.members.map((m, i) => renderMember(m, i))}
    </AgentActivityCard>
  );
};

/**
 * The group's leading glyph: its members' own icon when they all resolve to
 * one, and a neutral stack when the run mixes families — inventing a winner
 * among unrelated tools would misdescribe the row.
 */
function groupIcon(members: ActivityMember[]): LucideIcon {
  const icons = new Set<LucideIcon>();
  for (const m of members) {
    if (m.type !== "action") continue;
    icons.add(pickToolIcon({ vendorToolName: m.part.vendorToolName, toolKind: m.part.toolKind }));
  }
  return icons.size === 1 ? [...icons][0] : Layers;
}
