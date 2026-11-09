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
  thinkingMs?: number;
  open: boolean;
  onToggle: () => void;
  renderMember: (member: ActivityMember, key: string | number) => React.ReactNode;
  liveStep?: React.ReactNode;
}

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

function groupIcon(members: ActivityMember[]): LucideIcon {
  const icons = new Set<LucideIcon>();
  for (const m of members) {
    if (m.type !== "action") continue;
    icons.add(pickToolIcon({ vendorToolName: m.part.vendorToolName, toolKind: m.part.toolKind }));
  }
  return icons.size === 1 ? [...icons][0] : Layers;
}
