import React, { useState } from "react";
import { buildAgentTrail, splitTrailingText, type RenderNode } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart, StopReason } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { AggregateCard } from "@/agentMode/ui/AggregateCard";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";
import { Sparkles, ChevronRight } from "lucide-react";
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
  /** Backend stopReason once the turn has ended. Only `end_turn` triggers
   *  collapsing — cancelled / refusal / max_tokens leave the trail expanded
   *  so the user can see exactly where things stopped. */
  turnStopReason?: StopReason;
  /** Frozen wall-clock duration of the turn, in ms. Drives the
   *  "Worked for X" label on a collapsed turn. */
  turnDurationMs?: number;
}

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  showThinkingTail,
  app,
  turnStopReason,
  turnDurationMs,
}) => {
  // Decide whether the turn qualifies for the "Worked for X" collapse. The
  // collapse is post-stream only — while events are still arriving the user
  // sees every tool call land in real time.
  const canCollapse =
    !isStreaming &&
    turnStopReason === "end_turn" &&
    typeof turnDurationMs === "number" &&
    parts.length > 0;

  if (canCollapse) {
    const { research, final } = splitTrailingText(parts);
    // Both halves must be non-empty for a collapse to be meaningful: research
    // gives the user something to hide, and final gives them something to read
    // inline. If either is missing, fall through to the linear render.
    const researchHasContent = research.some((p) => p.kind !== "text" || p.text.trim().length > 0);
    const finalHasContent = final.some((p) => p.text.trim().length > 0);
    if (researchHasContent && finalHasContent) {
      return (
        <div className="tw-flex tw-flex-col tw-gap-1">
          <WorkedForBlock research={research} durationMs={turnDurationMs} app={app} />
          {final.map((p, i) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- text parts are append-only and may contain duplicate text
            <AgentMarkdownText key={`final-${i}`} text={p.text} app={app} />
          ))}
        </div>
      );
    }
  }

  return (
    <LinearTrail
      parts={parts}
      isStreaming={isStreaming}
      showThinkingTail={showThinkingTail}
      app={app}
    />
  );
};

/** Renders the full trail in chronological order — the pre-collapse view. */
const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  showThinkingTail?: boolean;
  app: App;
}> = ({ parts, isStreaming, showThinkingTail, app }) => {
  const tree = buildAgentTrail(parts);
  // A reasoning block is "still active" only while the turn is in flight AND
  // its `thought` part is the trailing entry of `msg.parts[]`. Anything later
  // (a tool_call, a sibling thought split by a tool_call, an `agent_message_chunk`)
  // proves the agent has moved on — even though ACP itself emits no explicit
  // "reasoning ended" notification. Comparing by reference against the last
  // part is robust to the hidden-tool filter inside `buildAgentTrail`: if the
  // last part is hidden, no reasoning node will match, so all reasoning blocks
  // freeze — which is the right outcome.
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {tree.map((node, i) => renderNode(node, i, isStreaming, app, lastPart))}
      {showThinkingTail ? <BottomLoadingIndicator /> : null}
    </div>
  );
};

interface WorkedForBlockProps {
  research: AgentMessagePart[];
  durationMs: number;
  app: App;
}

/**
 * Collapsed-by-default "Worked for X" header that wraps the research portion
 * of a completed turn. Clicking expands the original trail inline — same
 * components as the linear path, no streaming spinners (the turn has ended).
 */
const WorkedForBlock: React.FC<WorkedForBlockProps> = ({ research, durationMs, app }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="tw-mb-2 tw-mt-1 tw-w-full max-md:tw-mb-1.5 max-md:tw-mt-0.5"
    >
      <CollapsibleTrigger asChild>
        <div className="copilot-divider-b tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-1.5 tw-pb-2 tw-text-left tw-text-sm tw-text-muted hover:tw-text-normal">
          <span className="tw-flex tw-size-icon-xs tw-shrink-0 tw-items-center tw-justify-center">
            <Sparkles className="tw-size-3 tw-text-muted" />
          </span>
          <span className="tw-font-medium">Worked for</span>
          <span className="tw-text-muted">{formatDuration(durationMs)}</span>
          <ChevronRight
            className={cn(
              "tw-ml-auto tw-size-3 tw-text-muted tw-transition-transform",
              isExpanded && "tw-rotate-90"
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="tw-mt-2">
          <LinearTrail parts={research} isStreaming={false} app={app} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

function renderNode(
  node: RenderNode,
  key: string | number,
  isStreaming: boolean,
  app: App,
  lastPart: AgentMessagePart | undefined
): React.ReactNode {
  switch (node.type) {
    case "action":
      return <ActionCard key={key} part={node.part} />;
    case "aggregate":
      return <AggregateCard key={key} parts={node.parts} />;
    case "subagent":
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          childNodes={node.children}
          truncated={node.truncated}
          app={app}
          renderNode={(n, k) => renderNode(n, k, isStreaming, app, lastPart)}
        />
      );
    case "reasoning": {
      const isActive = isStreaming && node.part === lastPart;
      return <ReasoningBlock key={key} part={node.part} isStreaming={isActive} />;
    }
    case "text":
      return <AgentMarkdownText key={key} text={node.part.text} app={app} />;
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} />;
  }
}

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
}

// Inline plan-checklist pill for `kind: "plan"` parts. Permission-gated
// plan proposals are handled separately by `PlanProposalCard`.
const PlanPill: React.FC<PlanPillProps> = ({ entries }) => (
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
