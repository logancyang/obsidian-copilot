import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { App } from "obsidian";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { GroupedTrailNode } from "@/agentMode/ui/activityGroups";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
  lookupToolSummary,
} from "@/agentMode/ui/toolSummaries";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

interface SubAgentCardProps {
  parent: ToolCallPart;
  childNodes: GroupedTrailNode[];
  truncated?: boolean;
  app: App;
  // Passed in by AgentTrail rather than imported, so this file never has to
  // know about the concrete card components AgentTrail dispatches to.
  renderNode: (node: GroupedTrailNode, key: string | number) => React.ReactNode;
}

/**
 * Keeps delegated work attached to its launch so the prompt, progress, and report remain one traceable unit.
 * @param parent - The tool call that launched the delegated work.
 * @param childNodes - The nested activity produced by the delegated work.
 * @param truncated - Whether omitted activity should be disclosed to the user.
 * @param app - The Obsidian application used to render note-aware content.
 * @param renderNode - The renderer for nested agent-trail nodes.
 */
export const SubAgentCard: React.FC<SubAgentCardProps> = ({
  parent,
  childNodes,
  truncated,
  app,
  renderNode,
}) => {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const summary = lookupToolSummary(parent);
  const Icon = summary.icon;
  const line = summary.collapsedLine(parent);
  const outcome = summary.outcome(parent);
  const childCounts = countChildren(childNodes);
  const inputPrompt = extractSubAgentInputPrompt(parent);
  const returnText = extractSubAgentReturnText(parent);

  return (
    <AgentActivityCard
      icon={Icon}
      label={line}
      trailing={<StatusBadge status={parent.status} />}
      secondary={outcome}
      expandable
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {childCounts.tools > 0 || childCounts.reasoning > 0 || truncated ? (
        <div className="tw-text-xs tw-text-muted">{describeCounts(childCounts, truncated)}</div>
      ) : null}
      {inputPrompt ? (
        <div className="tw-my-1">
          <div
            className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-xs tw-text-muted"
            onClick={() => setPromptOpen((v) => !v)}
            role="button"
          >
            <span className="tw-flex-1 tw-truncate">Prompt</span>
            {promptOpen ? (
              <ChevronDown className="tw-size-3" />
            ) : (
              <ChevronRight className="tw-size-3" />
            )}
          </div>
          {promptOpen ? (
            <div className="tw-mt-1 tw-border-l-[2px] tw-border-border tw-pl-2">
              <AgentMarkdownText text={inputPrompt} app={app} />
            </div>
          ) : null}
        </div>
      ) : null}
      {truncated ? (
        <div className="tw-text-xs tw-text-muted">
          Nested sub-agent — expand the parent to drill in.
        </div>
      ) : (
        childNodes.map((c, i) => renderNode(c, i))
      )}
      {returnText ? (
        <div className="tw-my-1 tw-border-l-[2px] tw-border-border tw-pl-2">
          <AgentMarkdownText text={returnText} app={app} />
        </div>
      ) : null}
    </AgentActivityCard>
  );
};

interface ChildCounts {
  tools: number;
  reasoning: number;
}

function countChildren(nodes: GroupedTrailNode[]): ChildCounts {
  let tools = 0;
  let reasoning = 0;
  for (const n of nodes) {
    if (n.type === "action" || n.type === "subagent") tools += 1;
    else if (n.type === "reasoning") reasoning += 1;
    else if (n.type === "activityGroup") {
      for (const m of n.members) {
        if (m.type === "action") tools += 1;
        else reasoning += 1;
      }
    }
    // `text` and `plan` are intentionally not counted — the sub-agent header
    // surfaces *work* done (tools + reasoning), not narration. Streamed prose
    // and plan checklists still render in the expanded body.
  }
  return { tools, reasoning };
}

function describeCounts(c: ChildCounts, truncated?: boolean): string {
  if (truncated) return "Nested";
  const bits: string[] = [];
  if (c.tools > 0) bits.push(`${c.tools} ${c.tools === 1 ? "tool" : "tools"}`);
  if (c.reasoning > 0) bits.push(`${c.reasoning} reasoning`);
  return bits.length > 0 ? bits.join(" · ") : "No activity";
}
