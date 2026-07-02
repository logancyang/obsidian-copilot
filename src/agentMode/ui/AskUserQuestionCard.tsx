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

/**
 * Whether a question has enough input to submit. Mirrors Claude Code's "Other"
 * affordance: an active "Other" row is only satisfied once its free-form text
 * is non-empty, so it can gate Submit independently of the preset options.
 */
function isAnswered(
  question: AgentQuestion,
  selection: string | Set<string> | undefined,
  otherActive: boolean,
  customText: string
): boolean {
  if (otherActive) return customText.trim().length > 0;
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
 *
 * Each question also offers an "Other" row that reveals a free-form textarea,
 * so the user can answer when none of the agent's options fit — the typed text
 * is folded into the same plain-string answer the presets produce.
 */
export const AskUserQuestionCard: React.FC<AskUserQuestionCardProps> = ({ request, onResolve }) => {
  const { questions, requestId } = request;
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  // Per-question selection: a single label for radio, a Set of labels for checkbox.
  const [selections, setSelections] = useState<Record<number, string | Set<string>>>({});
  // Per-question "Other" state, kept out of the option-label value space so a
  // custom answer can never collide with a real option label.
  const [otherActive, setOtherActive] = useState<Record<number, boolean>>({});
  const [customTexts, setCustomTexts] = useState<Record<number, string>>({});

  // Gate Submit until every single-select question has a pick (or a non-empty
  // "Other"). Multi-select questions may be left empty unless "Other" is armed,
  // in which case its text must be filled.
  const canSubmit = questions.every((q, idx) =>
    isAnswered(q, selections[idx], otherActive[idx] ?? false, customTexts[idx] ?? "")
  );

  const submit = (): void => {
    if (busy || !canSubmit) return;
    setBusy(true);
    const answers: AgentQuestionAnswers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections[i];
      const other = otherActive[i] ?? false;
      const text = (customTexts[i] ?? "").trim();
      if (q.multiSelect) {
        const labels = sel instanceof Set ? Array.from(sel) : [];
        if (other && text) labels.push(text);
        answers[q.question] = labels.join(", ");
      } else {
        // "Other" wins over any stale preset (radio exclusivity clears it anyway).
        answers[q.question] = other ? text : typeof sel === "string" ? sel : "";
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

  // Choosing a preset. Single-select picks one label and disarms "Other";
  // multi-select toggles the label in its Set and leaves "Other" alone.
  const togglePreset = (label: string): void => {
    if (active.multiSelect) {
      setSelections((prev) => {
        const cur = prev[activeIdx];
        const next = new Set(cur instanceof Set ? cur : []);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return { ...prev, [activeIdx]: next };
      });
      return;
    }
    setSelections((prev) => ({ ...prev, [activeIdx]: label }));
    setOtherActive((prev) => ({ ...prev, [activeIdx]: false }));
  };

  // Choosing "Other". Single-select arms it exclusively (clearing the radio
  // pick); multi-select toggles it alongside any checked presets.
  const toggleOther = (): void => {
    if (active.multiSelect) {
      setOtherActive((prev) => ({ ...prev, [activeIdx]: !(prev[activeIdx] ?? false) }));
      return;
    }
    setOtherActive((prev) => ({ ...prev, [activeIdx]: true }));
    setSelections((prev) => ({ ...prev, [activeIdx]: "" }));
  };

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
          otherActive={otherActive[activeIdx] ?? false}
          customText={customTexts[activeIdx] ?? ""}
          disabled={busy}
          onTogglePreset={togglePreset}
          onToggleOther={toggleOther}
          onCustomTextChange={(text) => setCustomTexts((prev) => ({ ...prev, [activeIdx]: text }))}
          onSubmitShortcut={submit}
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
  otherActive: boolean;
  customText: string;
  disabled: boolean;
  onTogglePreset: (label: string) => void;
  onToggleOther: () => void;
  onCustomTextChange: (text: string) => void;
  /** Cmd/Ctrl+Enter in the textarea; the parent guards on `canSubmit`. */
  onSubmitShortcut: () => void;
}

/** The active question's prompt text plus its single- or multi-select option list. */
const QuestionPanel: React.FC<QuestionPanelProps> = ({
  question,
  name,
  selection,
  otherActive,
  customText,
  disabled,
  onTogglePreset,
  onToggleOther,
  onCustomTextChange,
  onSubmitShortcut,
}) => {
  const control = question.multiSelect ? "checkbox" : "radio";
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
                  type={control}
                  name={name}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onTogglePreset(opt.label)}
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

        {/* "Other" escape hatch: shares the radio group name so single-select
            grouping stays native, and reveals a free-form textarea when armed. */}
        <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2 tw-rounded tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover">
          <span className="tw-flex tw-h-5 tw-shrink-0 tw-items-center">
            <input
              type={control}
              name={name}
              checked={otherActive}
              disabled={disabled}
              onChange={onToggleOther}
              className="tw-m-0"
            />
          </span>
          <div className="tw-min-w-0">
            <div className="tw-text-sm tw-leading-5">Other</div>
            <div className="tw-text-xs tw-text-muted">Type your own response</div>
          </div>
        </label>
      </div>

      {otherActive ? (
        <textarea
          className="tw-min-h-9 tw-w-full tw-resize-y tw-rounded tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-sm tw-text-normal tw-outline-none focus:tw-border-border-focus"
          placeholder="Type your response…"
          value={customText}
          disabled={disabled}
          autoFocus
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          rows={2}
        />
      ) : null}
    </div>
  );
};
