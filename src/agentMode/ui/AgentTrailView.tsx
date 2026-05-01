import React from "react";
import { buildAgentTrail, type RenderNode } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { AggregateCard } from "@/agentMode/ui/AggregateCard";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  /** True iff this message is the one currently being streamed by the
   *  agent. Drives reasoning-block spinner / timer. */
  isStreaming: boolean;
  /** Obsidian `App` for the markdown renderer used by `text` parts. */
  app: App;
}

export const AgentTrail: React.FC<AgentTrailProps> = ({ parts, isStreaming, app }) => {
  const tree = buildAgentTrail(parts);
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {tree.map((node, i) => renderNode(node, i, isStreaming, app))}
    </div>
  );
};

function renderNode(
  node: RenderNode,
  key: string | number,
  isStreaming: boolean,
  app: App
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
          renderNode={(n, k) => renderNode(n, k, isStreaming, app)}
        />
      );
    case "reasoning":
      return <ReasoningBlock key={key} part={node.part} isStreaming={isStreaming} />;
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
        <li key={i} className="tw-flex tw-items-start tw-gap-2">
          <span aria-hidden="true">{planEntryIcon(e.status)}</span>
          <span className={planEntryClass(e.status)}>{e.content}</span>
        </li>
      ))}
    </ul>
  </div>
);

export default AgentTrail;
