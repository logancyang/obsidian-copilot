import React, { useMemo } from "react";
import { agentResponseText, buildAgentTrail } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart, StopReason } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
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
import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
import { getVaultBase } from "@/utils/vaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  /** True iff this message is the one currently being streamed by the
   *  agent. Drives reasoning-block spinner / timer. */
  isStreaming: boolean;
  /** When true, render a "Thinking" shimmer as the last item of the trail.
   *  Anchors the in-flight indicator to the streaming message's own bubble
   *  (e.g., directly under a populating SubAgentCard) instead of pinning it
   *  to the bottom of the chat container. */
  showThinkingTail?: boolean;
  /** Obsidian `App` for the markdown renderer used by `text` parts. */
  app: App;
  /** Backend stopReason once the turn has ended. Only `cancelled` suppresses
   *  the Copy / Insert affordances (treated as having no user-visible answer). */
  turnStopReason?: StopReason;
}

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  showThinkingTail,
  app,
  turnStopReason,
}) => {
  // Copy / Insert act on the agent's full textual response. Gate them off while
  // the message is still streaming and on cancelled turns (treated as having no
  // user-visible answer), plus whenever there is no prose to act on.
  const answer = agentResponseText(parts);
  const actions =
    !isStreaming && turnStopReason !== "cancelled" && answer.length > 0 ? (
      <AgentMessageActions text={answer} app={app} />
    ) : null;

  return (
    <div className="tw-group tw-flex tw-flex-col tw-gap-1">
      <LinearTrail
        parts={parts}
        isStreaming={isStreaming}
        showThinkingTail={showThinkingTail}
        app={app}
      />
      {actions}
    </div>
  );
};

/** What every node in one trail renders against, regardless of its position. */
interface TrailContext {
  isStreaming: boolean;
  app: App;
  /** The trail's trailing part, reference-compared to freeze stale reasoning. */
  lastPart: AgentMessagePart | undefined;
  /** Which activity groups the user has opened; owned above the node list so an
   *  open group survives the reshaping that streaming causes. */
  expansion: TrailExpansion;
  summaryCtx: ToolSummaryContext;
}

/** Renders the full trail in chronological order — the pre-collapse view. */
const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  showThinkingTail?: boolean;
  app: App;
}> = ({ parts, isStreaming, showThinkingTail, app }) => {
  const expansion = useTrailExpansion();
  // `vaultBase` is stable for the plugin lifetime, but memoizing keeps the
  // summary inputs referentially stable across re-renders.
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const nodes = foldActivityGroups(buildAgentTrail(parts));
  // A reasoning block is "still active" only while the turn is in flight AND
  // its `thought` part is the trailing entry of `msg.parts[]`. Anything later
  // (a tool_call, a sibling thought split by a tool_call, an `agent_message_chunk`)
  // proves the agent has moved on — even though ACP itself emits no explicit
  // "reasoning ended" notification. Comparing by reference against the last
  // part is robust to the hidden-tool filter inside `buildAgentTrail`: if the
  // last part is hidden, no reasoning node will match, so all reasoning blocks
  // freeze — which is the right outcome.
  const ctx: TrailContext = {
    isStreaming,
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    summaryCtx,
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {nodes.map((node, i) => renderNode(node, i, ctx, i === nodes.length - 1))}
      {showThinkingTail ? <BottomLoadingIndicator /> : null}
    </div>
  );
};

/**
 * @param isLast - Whether this node closes its peer list. Only the closing node
 *   of a streaming trail may show motion; an earlier group has finished.
 */
function renderNode(
  node: GroupedTrailNode,
  key: string | number,
  ctx: TrailContext,
  isLast: boolean
): React.ReactNode {
  switch (node.type) {
    case "action":
      return <ActionCard key={key} part={node.part} />;
    case "activityGroup":
      return (
        <ActivityGroupRow key={key} group={node} ctx={ctx} atLiveEdge={ctx.isStreaming && isLast} />
      );
    case "subagent": {
      // Peers nest, so a sub-agent's own children group exactly like the root.
      const children = foldActivityGroups(node.children);
      const lastChild = children[children.length - 1];
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          childNodes={children}
          truncated={node.truncated}
          app={ctx.app}
          renderNode={(n, k) => renderNode(n, k, ctx, n === lastChild)}
        />
      );
    }
    case "reasoning": {
      const isActive = ctx.isStreaming && node.part === ctx.lastPart;
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
  /** Whether this group is the one the agent is still working in. */
  atLiveEdge: boolean;
  ctx: TrailContext;
}

// A component rather than a branch of `renderNode` because each group owns its
// own thinking clock, and hooks cannot run in a loop.
const ActivityGroupRow: React.FC<ActivityGroupRowProps> = ({ group, atLiveEdge, ctx }) => {
  const thinkingMs = useThinkingClock(isReasoningActive(group.members, atLiveEdge));
  return (
    <ActivityGroupCard
      group={group}
      thinkingMs={thinkingMs}
      open={ctx.expansion.isOpen(group.id)}
      onToggle={() => ctx.expansion.toggle(group.id)}
      renderMember={(member, i) =>
        renderNode(member, member.type === "action" ? member.part.id : `thought-${i}`, ctx, false)
      }
      liveStep={activityLiveStep(group.members, atLiveEdge, ctx.summaryCtx)}
    />
  );
};

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
}

// Inline plan-checklist pill for `kind: "plan"` parts. Permission-gated
// plan proposals are handled separately by `PlanProposalCard`. An empty
// entries list (the agent deleted every task) renders nothing, not an
// empty shell.
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

export default AgentTrail;
