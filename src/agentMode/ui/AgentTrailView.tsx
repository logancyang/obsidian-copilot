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
import { CompactionRow } from "@/agentMode/ui/CompactionRow";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import type { ToolSummaryContext } from "@/agentMode/ui/toolSummaries";
import { miyoResultPaths, miyoSearchRun } from "@/miyo/agentMode/miyoSearchRun";
import { MiyoSearchCard } from "@/miyo/agentMode/ui/MiyoSearchCard";
import { useThinkingClock } from "@/agentMode/ui/useThinkingClock";
import { useTrailExpansion, type TrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { useAgentTasks, type AgentTasksContextValue } from "@/agentMode/ui/AgentTasksContext";
import { TaskCard } from "@/agentMode/ui/TaskCard";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { getVaultBase } from "@/utils/vaultPath";
import { openVaultPath } from "@/utils/openVaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  isStreaming: boolean;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  timestamp?: string;
  app: App;
  turnStopReason?: StopReason;
  errorText?: string;
  fileChanges?: TurnFileChange[];
  onOpenFileChange?: (change: TurnFileChange) => void;
}

const noopOpenFileChange = () => {};

// A turn that ends early without an error leaves a reply that looks finished. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
const EARLY_STOP_CAUSES: Partial<Record<StopReason, string>> = {
  max_tokens: "the model hit its output limit",
  max_turn_requests: "the agent hit its step limit",
  refusal: "the model's safety system stopped it",
};

function stopReasonNotice(stopReason: StopReason | undefined): string | undefined {
  const cause = stopReason && EARLY_STOP_CAUSES[stopReason];
  return (
    cause &&
    `**Stopped early:** ${cause}, so its last step may not have run. Send another message to continue.`
  );
}

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  turnStartedAtMs,
  turnDurationMs,
  timestamp,
  app,
  turnStopReason,
  errorText,
  fileChanges,
  onOpenFileChange = noopOpenFileChange,
}) => {
  const answer = agentResponseText(parts);
  // A failed turn's error is stored as message text, which a reply with parts never shows.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
  const notice = errorText && answer.length === 0 ? errorText : stopReasonNotice(turnStopReason);
  const hasRunningDuration = isStreaming && turnStartedAtMs !== undefined;
  // A compaction row reports its own progress and is not a reply to time or copy.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
  const trailNodes = buildAgentTrail(parts);
  const compactionOnly =
    trailNodes.length > 0 && trailNodes.every((node) => node.type === "compaction");
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
      {notice ? (
        <div className="tw-text-error">
          <AgentMarkdownText text={notice} app={app} />
        </div>
      ) : null}
      {turnStopReason !== undefined && fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
      {hasRunningDuration && !compactionOnly ? (
        <AgentTurnDurationIndicator status="running" startedAtMs={turnStartedAtMs} />
      ) : null}
      {compactionOnly ? null : footer}
    </div>
  );
};

interface TrailContext {
  app: App;
  lastPart: AgentMessagePart | undefined;
  expansion: TrailExpansion;
  summaryCtx: ToolSummaryContext;
  miyoPaths: readonly string[];
  tasks: AgentTasksContextValue | null;
}

const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  app: App;
}> = ({ parts, isStreaming, app }) => {
  const expansion = useTrailExpansion();
  const tasks = useAgentTasks();
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  // A task's launching card must stay visible, not folded into "Ran N commands". https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  const nodes = foldActivityGroups(buildAgentTrail(parts), (part) =>
    Boolean(tasks?.tasks.some((task) => task.toolCallId === part.id))
  );
  const ctx: TrailContext = {
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    summaryCtx,
    miyoPaths: miyoResultPaths(parts),
    tasks,
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
  // A task's work is shown in its own view, so its launching call is only a link there. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  const launch = node.type === "action" ? node.part : node.type === "subagent" ? node.parent : null;
  const task = launch && ctx.tasks?.tasks.find((t) => t.toolCallId === launch.id);
  if (task && ctx.tasks) return <TaskCard key={key} task={task} onOpen={ctx.tasks.openTask} />;
  switch (node.type) {
    case "action": {
      const expansionId = actionExpansionId(trailId, node.part.id);
      const miyoSearch = miyoSearchRun(node.part);
      if (miyoSearch) {
        return (
          <MiyoSearchCard
            key={key}
            {...miyoSearch}
            open={ctx.expansion.isOpen(expansionId)}
            onToggle={() => ctx.expansion.toggle(expansionId)}
            onOpenNote={(path) => openVaultPath(ctx.app, path, { newLeaf: true })}
          />
        );
      }
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
      return (
        <AgentMarkdownText
          key={key}
          text={node.part.text}
          app={ctx.app}
          miyoPaths={ctx.miyoPaths}
        />
      );
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} />;
    case "compaction":
      return <CompactionRow key={key} part={node.part} />;
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
