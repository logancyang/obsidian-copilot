import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { App } from "obsidian";
import type { ToolCallPart, RenderNode } from "@/agentMode/ui/agentTrail";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
  lookupToolSummary,
} from "@/agentMode/ui/toolSummaries";

interface SubAgentCardProps {
  parent: ToolCallPart;
  childNodes: RenderNode[];
  truncated?: boolean;
  app: App;
  // Passed in by AgentTrail rather than imported, so this file never has to
  // know about the concrete card components AgentTrail dispatches to.
  renderNode: (node: RenderNode, key: string | number) => React.ReactNode;
}

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
  const childCounts = countChildren(childNodes);
  const inputPrompt = extractSubAgentInputPrompt(parent);
  const returnText = extractSubAgentReturnText(parent);

  return (
    <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1.5">
      <div
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-sm"
        onClick={() => setOpen((v) => !v)}
        role="button"
      >
        <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{line}</span>
        <StatusBadge status={parent.status} />
        {open ? (
          <ChevronDown className="tw-size-3 tw-text-muted" />
        ) : (
          <ChevronRight className="tw-size-3 tw-text-muted" />
        )}
      </div>
      <div className="tw-pl-6 tw-text-xs tw-text-muted">
        {describeCounts(childCounts, truncated)}
      </div>
      {open ? (
        <div className="tw-mt-2 tw-flex tw-flex-col tw-gap-1 tw-border-l tw-border-border tw-pl-3">
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
        </div>
      ) : null}
    </div>
  );
};

interface ChildCounts {
  tools: number;
  reasoning: number;
}

function countChildren(nodes: RenderNode[]): ChildCounts {
  let tools = 0;
  let reasoning = 0;
  for (const n of nodes) {
    if (n.type === "action") tools += 1;
    else if (n.type === "aggregate") tools += n.parts.length;
    else if (n.type === "subagent") tools += 1;
    else if (n.type === "reasoning") reasoning += 1;
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
