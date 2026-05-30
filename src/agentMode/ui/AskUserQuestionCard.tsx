import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
} from "@/agentMode/session/types";
import { MessageCircleQuestion } from "lucide-react";
import React, { useState } from "react";

interface AskUserQuestionCardProps {
  request: AskUserQuestionPrompt;
  onResolve: (requestId: string, answers: AgentQuestionAnswers) => void;
}

/** A single-select pick is "answered" once a label is chosen; multi-select is always satisfiable. */
function isAnswered(question: AgentQuestion, selection: string | Set<string> | undefined): boolean {
  if (question.multiSelect) return true;
  return typeof selection === "string" && selection !== "";
}

/**
 * Inline card rendered at the tail of the chat scroll container while the
 * agent's `AskUserQuestion` tool waits on the user — the sibling of
 * `ToolPermissionCard`. Replaces the old `AskUserQuestionModal`: modals steal
 * focus and resolve as a cancel on accidental click-outside, which is
 * inconsistent with the rest of Agent Mode's inline-card model.
 *
 * A single call may carry several questions; each renders under its own tab so
 * the card stays compact, while the answers still submit together to honor the
 * SDK's single-response contract. Submitting routes the answers map through the
 * ask-question prompter's happy path; Cancel resolves with `{}`, which the
 * bridge maps to the "User cancelled the question" deny.
 */
export const AskUserQuestionCard: React.FC<AskUserQuestionCardProps> = ({ request, onResolve }) => {
  const { questions, requestId } = request;
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  // Per-question selection: a single label for radio, a Set of labels for checkbox.
  const [selections, setSelections] = useState<Record<number, string | Set<string>>>({});

  // Gate Submit until every single-select question has a pick. Multi-select
  // questions may be left empty (the user can decline every option).
  const canSubmit = questions.every((q, idx) => isAnswered(q, selections[idx]));

  const submit = (): void => {
    if (busy || !canSubmit) return;
    setBusy(true);
    const answers: AgentQuestionAnswers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections[i];
      if (q.multiSelect) {
        answers[q.question] = sel instanceof Set ? Array.from(sel).join(", ") : "";
      } else {
        answers[q.question] = typeof sel === "string" ? sel : "";
      }
    }
    onResolve(requestId, answers);
  };

  const cancel = (): void => {
    if (busy) return;
    setBusy(true);
    onResolve(requestId, {});
  };

  const showTabs = questions.length > 1;
  const active = questions[activeTab] ?? questions[0];
  const activeIdx = questions[activeTab] ? activeTab : 0;

  return (
    <div className="tw-mx-3 tw-my-2 tw-w-[calc(100%-1.5rem)] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2">
        <MessageCircleQuestion className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <div className="tw-truncate tw-text-sm tw-font-medium">Question from agent</div>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2 tw-px-3 tw-py-2">
        {showTabs ? (
          <div role="tablist" className="copilot-divider-b tw-flex tw-flex-wrap tw-gap-x-1">
            {questions.map((q, idx) => {
              const selected = idx === activeIdx;
              return (
                <button
                  key={q.question}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={busy}
                  onClick={() => setActiveTab(idx)}
                  className={cn(
                    // Underline tab: a colored inset bottom edge marks the
                    // active question. box-shadow (not a border) avoids the
                    // preflight-off border-style leak, and overlaps the
                    // tablist's divider so the accent replaces the grey rule.
                    "tw--mb-px !tw-rounded-none !tw-border-none !tw-bg-transparent tw-p-1.5 tw-text-sm tw-transition-colors",
                    "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
                    selected
                      ? "tw-font-medium tw-text-normal !tw-shadow-[inset_0_-2px_0_0_var(--interactive-accent)]"
                      : "tw-text-muted !tw-shadow-none hover:tw-text-normal"
                  )}
                >
                  {q.header || `Question ${idx + 1}`}
                </button>
              );
            })}
          </div>
        ) : null}

        <QuestionPanel
          key={active.question}
          question={active}
          name={`askq-${requestId}-${activeIdx}`}
          selection={selections[activeIdx]}
          disabled={busy}
          onToggle={(label) =>
            setSelections((prev) => {
              if (active.multiSelect) {
                const cur = prev[activeIdx];
                const next = new Set(cur instanceof Set ? cur : []);
                if (next.has(label)) next.delete(label);
                else next.add(label);
                return { ...prev, [activeIdx]: next };
              }
              return { ...prev, [activeIdx]: label };
            })
          }
        />
      </div>

      <div className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-px-3 tw-py-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
        <Button variant="default" size="sm" disabled={busy || !canSubmit} onClick={submit}>
          Submit
        </Button>
      </div>
    </div>
  );
};

interface QuestionPanelProps {
  question: AgentQuestion;
  /** Radio-group name; namespaced by requestId + index so cards don't collide. */
  name: string;
  selection: string | Set<string> | undefined;
  disabled: boolean;
  onToggle: (label: string) => void;
}

/** The active question's prompt text plus its single- or multi-select option list. */
const QuestionPanel: React.FC<QuestionPanelProps> = ({
  question,
  name,
  selection,
  disabled,
  onToggle,
}) => {
  return (
    <div role="tabpanel" className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-text-sm">{question.question}</div>
      <div className="tw-flex tw-flex-col tw-gap-1">
        {question.options.map((opt) => {
          const checked = question.multiSelect
            ? selection instanceof Set && selection.has(opt.label)
            : selection === opt.label;
          return (
            <label
              key={opt.label}
              className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2 tw-rounded tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover"
            >
              {/* Center the control in a box matching the label's line height so
                  it top-aligns with the first line of text, not its mid-point.
                  `tw-m-0` strips the asymmetric default margin browsers give
                  native checkboxes/radios, which was throwing off alignment. */}
              <span className="tw-flex tw-h-5 tw-shrink-0 tw-items-center">
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={name}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(opt.label)}
                  className="tw-m-0"
                />
              </span>
              <div className="tw-min-w-0">
                <div className="tw-text-sm tw-leading-5">{opt.label}</div>
                {opt.description ? (
                  <div className="tw-text-xs tw-text-muted">{opt.description}</div>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
