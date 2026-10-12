import React, { useMemo } from "react";
import { agentResponseText, buildAgentTrail } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart, StopReason, TurnFileChange } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import {
  foldActivityGroups,
  type ActivityGroupNode,
  type GroupedTrailNode,
} from "@/agentMode/ui/activityGroups";
import { activityLiveStep, isReasoningActive } from "@/agentMode/ui/activityLiveStep";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import type { ToolSummaryContext } from "@/agentMode/ui/toolSummaries";
import { useThinkingClock } from "@/agentMode/ui/useThinkingClock";
import { useTrailExpansion, type TrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { getVaultBase } from "@/utils/vaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  isStreaming: boolean;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  timestamp?: string;
  app: App;
  turnStopReason?: StopReason;
  fileChanges?: TurnFileChange[];
  onOpenFileChange?: (change: TurnFileChange) => void;
}

const noopOpenFileChange = () => {};

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  turnStartedAtMs,
  turnDurationMs,
  timestamp,
  app,
  turnStopReason,
  fileChanges,
  onOpenFileChange = noopOpenFileChange,
}) => {
  const answer = agentResponseText(parts);
  const hasRunningDuration = isStreaming && turnStartedAtMs !== undefined;
  const footer =
    !isStreaming && turnStopReason !== "cancelled" && answer.length > 0 ? (
      <AgentMessageActions
        text={answer}
        app={app}
        durationMs={turnDurationMs}
        timestamp={timestamp}
      />
    ) : turnDurationMs !== undefined ? (
      <AssistantResponseFooter
        leading={
          <AgentTurnDurationIndicator status="complete" durationMs={turnDurationMs} inline />
        }
      />
    ) : !hasRunningDuration && timestamp ? (
      <AssistantResponseFooter timestamp={timestamp} />
    ) : null;

  return (
    <div className="tw-group tw-flex tw-flex-col tw-gap-1">
      <LinearTrail parts={parts} isStreaming={isStreaming} app={app} />
      {turnStopReason !== undefined && fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
      {hasRunningDuration ? (
        <AgentTurnDurationIndicator status="running" startedAtMs={turnStartedAtMs} />
      ) : null}
      {footer}
    </div>
  );
};

interface TrailContext {
  app: App;
  lastPart: AgentMessagePart | undefined;
  expansion: TrailExpansion;
  summaryCtx: ToolSummaryContext;
}

const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  app: App;
}> = ({ parts, isStreaming, app }) => {
  const expansion = useTrailExpansion();
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const nodes = foldActivityGroups(buildAgentTrail(parts));
  const ctx: TrailContext = {
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    summaryCtx,
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {nodes.map((node, i) =>
        renderNode(node, i, ctx, isStreaming && i === nodes.length - 1, "root")
      )}
    </div>
  );
};

function renderNode(
  node: GroupedTrailNode,
  key: string | number,
  ctx: TrailContext,
  atLiveEdge: boolean,
  trailId: string
): React.ReactNode {
  switch (node.type) {
    case "action": {
      const expansionId = actionExpansionId(trailId, node.part.id);
      return (
        <ActionCard
          key={key}
          part={node.part}
          open={ctx.expansion.isOpen(expansionId)}
          onToggle={() => ctx.expansion.toggle(expansionId)}
        />
      );
    }
    case "activityGroup":
      return (
        <ActivityGroupRow
          key={key}
          group={node}
          ctx={ctx}
          atLiveEdge={atLiveEdge}
          trailId={trailId}
        />
      );
    case "subagent": {
      const children = foldActivityGroups(node.children);
      const lastChild = children[children.length - 1];
      const childTrailId = `${trailId}/subagent:${node.parent.id}`;
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          childNodes={children}
          truncated={node.truncated}
          app={ctx.app}
          renderNode={(n, k) => renderNode(n, k, ctx, atLiveEdge && n === lastChild, childTrailId)}
        />
      );
    }
    case "reasoning": {
      // Replacing an earlier singleton plan can freeze the final thought
      // without appending another raw part, so duration also ends live state.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
      const isActive =
        atLiveEdge && node.part === ctx.lastPart && node.part.durationMs === undefined;
      return <ReasoningBlock key={key} part={node.part} isStreaming={isActive} />;
    }
    case "text":
      return <AgentMarkdownText key={key} text={node.part.text} app={ctx.app} />;
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} />;
  }
}

interface ActivityGroupRowProps {
  group: ActivityGroupNode;
  atLiveEdge: boolean;
  ctx: TrailContext;
  trailId: string;
}

const ActivityGroupRow: React.FC<ActivityGroupRowProps> = ({ group, atLiveEdge, ctx, trailId }) => {
  const trailingMember = group.members[group.members.length - 1];
  // A hidden trailing tool is absent from the rendered group but still ends
  // the preceding reasoning span in the raw message parts.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  const groupAtLiveEdge = atLiveEdge && trailingMember?.part === ctx.lastPart;
  const reasoningActive = isReasoningActive(group.members, groupAtLiveEdge);
  const activeThoughtStartedAtMs =
    reasoningActive && trailingMember?.type === "reasoning"
      ? trailingMember.part.startedAtMs
      : undefined;
  const thinkingMs = useThinkingClock(reasoningActive, activeThoughtStartedAtMs);
  const groupExpansionId = `${trailId}/group:${group.id}`;
  const memberExpansionIds = group.members.flatMap((member) =>
    member.type === "action" ? [actionExpansionId(trailId, member.part.id)] : []
  );
  const groupOpen =
    ctx.expansion.isOpen(groupExpansionId) ||
    memberExpansionIds.some((id) => ctx.expansion.isOpen(id));

  const toggleGroup = () => {
    if (!groupOpen) {
      ctx.expansion.toggle(groupExpansionId);
      return;
    }
    if (ctx.expansion.isOpen(groupExpansionId)) ctx.expansion.toggle(groupExpansionId);
    for (const id of memberExpansionIds) {
      if (ctx.expansion.isOpen(id)) ctx.expansion.toggle(id);
    }
  };

  return (
    <ActivityGroupCard
      group={group}
      thinkingMs={thinkingMs}
      open={groupOpen}
      onToggle={toggleGroup}
      renderMember={(member, i) =>
        renderNode(
          member,
          member.type === "action" ? member.part.id : `thought-${i}`,
          ctx,
          groupAtLiveEdge,
          trailId
        )
      }
      liveStep={activityLiveStep(group.members, groupAtLiveEdge, ctx.summaryCtx)}
    />
  );
};

function actionExpansionId(trailId: string, toolCallId: string): string {
  return `${trailId}/action:${toolCallId}`;
}

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
}

const PlanPill: React.FC<PlanPillProps> = ({ entries }) =>
  entries.length === 0 ? null : (
    <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
      <p className="tw-mb-1 tw-text-xs tw-text-muted">Plan</p>
      <ul className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm">
        {entries.map((e, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries are positional and may share content
          <li key={`plan-${i}`} className="tw-flex tw-items-start tw-gap-2">
            <span aria-hidden="true">{planEntryIcon(e.status)}</span>
            <span className={planEntryClass(e.status)}>{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
