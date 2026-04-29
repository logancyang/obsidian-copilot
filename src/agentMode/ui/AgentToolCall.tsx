import { formatAgentInput, renderDiff } from "@/agentMode/ui/diffRender";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import { AgentMessagePart, AgentToolStatus } from "@/agentMode/session/types";
import React from "react";

interface AgentToolCallProps {
  part: AgentMessagePart;
}

/**
 * Renders one structured part of an Agent Mode assistant message — a tool
 * call, a folded thought, or an inline plan checklist. Plan proposals
 * (the approve/reject/feedback card) are not message parts; they live on
 * the session-level `currentPlan` and are rendered inline at the tail of
 * the chat stream by `PlanProposalCard`.
 */
export const AgentToolCall: React.FC<AgentToolCallProps> = ({ part }) => {
  if (part.kind === "thought") {
    return (
      <details className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
        <summary className="tw-cursor-pointer tw-text-xs tw-text-muted">Thought</summary>
        <pre className="tw-mt-1 tw-whitespace-pre-wrap tw-text-xs">{part.text}</pre>
      </details>
    );
  }
  if (part.kind === "plan") {
    return (
      <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
        <p className="tw-mb-1 tw-text-xs tw-text-muted">Plan</p>
        <ul className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm">
          {part.entries.map((e, i) => (
            <li key={i} className="tw-flex tw-items-start tw-gap-2">
              <span aria-hidden="true">{planEntryIcon(e.status)}</span>
              <span className={planEntryClass(e.status)}>{e.content}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // tool_call
  return (
    <details
      className={`tw-my-1 tw-rounded tw-border tw-border-border tw-px-2 tw-py-1 ${toolCallBg(part.status)}`}
    >
      <summary className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-sm">
        <span aria-hidden="true">{toolStatusIcon(part.status)}</span>
        <span className="tw-flex-1 tw-truncate">{part.title}</span>
        {part.toolKind ? <code className="tw-text-xs tw-text-muted">{part.toolKind}</code> : null}
      </summary>
      <div className="tw-mt-1 tw-flex tw-flex-col tw-gap-1">
        {part.locations && part.locations.length > 0 ? (
          <ul className="tw-text-xs tw-text-muted">
            {part.locations.map((loc, i) => (
              <li key={i} className="tw-font-mono">
                {loc.path}
                {loc.line != null ? `:${loc.line}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {part.input !== undefined ? (
          <details>
            <summary className="tw-cursor-pointer tw-text-xs tw-text-muted">Input</summary>
            <pre className="tw-max-h-40 tw-overflow-auto tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs">
              {formatAgentInput(part.input) ?? ""}
            </pre>
          </details>
        ) : null}
        {part.output && part.output.length > 0 ? (
          <div className="tw-flex tw-flex-col tw-gap-1">
            {part.output.map((o, i) =>
              o.type === "text" ? (
                <pre
                  key={i}
                  className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs"
                >
                  {o.text}
                </pre>
              ) : (
                <div key={i} className="tw-rounded tw-bg-secondary-alt tw-p-1">
                  <p className="tw-font-mono tw-text-xs tw-text-muted">{o.path}</p>
                  <pre className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-text-xs">
                    {renderDiff(o.oldText, o.newText)}
                  </pre>
                </div>
              )
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
};

function toolStatusIcon(s: AgentToolStatus): string {
  switch (s) {
    case "pending":
      return "○";
    case "in_progress":
      return "◐";
    case "completed":
      return "●";
    case "failed":
      return "✕";
  }
}

function toolCallBg(s: AgentToolStatus): string {
  switch (s) {
    case "completed":
      return "tw-bg-success";
    case "failed":
      return "tw-bg-error";
    default:
      return "tw-bg-secondary";
  }
}
