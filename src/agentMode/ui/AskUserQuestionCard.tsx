import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommandResult } from "@/agentMode/protocol/commands";
import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
} from "@/agentMode/session/types";
import { MessageCircleQuestion } from "lucide-react";
import React, { useState } from "react";

interface AskUserQuestionCardProps {
  request: AskUserQuestionPrompt;
  /**
   * A rejected command re-enables the card so the user can answer again.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/611
   */
  onResolve: (requestId: string, answers: AgentQuestionAnswers) => Promise<CommandResult> | void;
}

function isAnswered(
  question: AgentQuestion,
  selection: string | Set<string> | undefined,
  otherActive: boolean,
  customText: string
): boolean {
  if (otherActive) return customText.trim().length > 0;
  if (question.multiSelect) {
    // An untouched or fully cleared multi-select must not become an empty-string answer.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/182
    return selection instanceof Set && selection.size > 0;
  }
  return typeof selection === "string" && selection !== "";
}

export const AskUserQuestionCard: React.FC<AskUserQuestionCardProps> = ({ request, onResolve }) => {
  const { questions, requestId } = request;
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [selections, setSelections] = useState<Record<number, string | Set<string>>>({});
  const [otherActive, setOtherActive] = useState<Record<number, boolean>>({});
  const [customTexts, setCustomTexts] = useState<Record<number, string>>({});

  const showTabs = questions.length > 1;
  const active = questions[activeTab] ?? questions[0];
  const activeIdx = questions[activeTab] ? activeTab : 0;

  const canSubmit = questions.every((q, idx) =>
    isAnswered(q, selections[idx], otherActive[idx] ?? false, customTexts[idx] ?? "")
  );
  const canAdvance = isAnswered(
    active,
    selections[activeIdx],
    otherActive[activeIdx] ?? false,
    customTexts[activeIdx] ?? ""
  );
  const isFinalQuestion = activeIdx === questions.length - 1;

  const resolve = async (answers: AgentQuestionAnswers): Promise<void> => {
    setBusy(true);
    const result = await onResolve(requestId, answers);
    if (result && !result.ok) setBusy(false);
  };

  const submit = (): void => {
    if (busy || !canSubmit) return;
    const answers: AgentQuestionAnswers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections[i];
      const other = otherActive[i] ?? false;
      const text = (customTexts[i] ?? "").trim();
      if (q.multiSelect) {
        const labels = sel instanceof Set ? Array.from(sel) : [];
        if (other && text) labels.push(text);
        answers[q.answerKey ?? q.question] = labels.join(", ");
      } else {
        answers[q.answerKey ?? q.question] = other ? text : typeof sel === "string" ? sel : "";
      }
    }
    void resolve(answers);
  };

  // Tabs may skip questions, so Next validates only the visible answer while
  // final Submit keeps the request-wide validation that prevents partial payloads.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/117
  const runPrimaryAction = (): void => {
    if (isFinalQuestion) {
      submit();
      return;
    }
    if (busy || !canAdvance) return;
    setActiveTab(activeIdx + 1);
  };

  const cancel = (): void => {
    if (busy) return;
    void resolve({});
  };

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

  const toggleOther = (): void => {
    if (active.multiSelect) {
      setOtherActive((prev) => ({ ...prev, [activeIdx]: !(prev[activeIdx] ?? false) }));
      return;
    }
    setOtherActive((prev) => ({ ...prev, [activeIdx]: true }));
    setSelections((prev) => ({ ...prev, [activeIdx]: "" }));
  };

  return (
    <div className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
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
                  key={q.answerKey ?? q.question}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={busy}
                  onClick={() => setActiveTab(idx)}
                  className={cn(
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
          key={active.answerKey ?? active.question}
          question={active}
          name={`askq-${requestId}-${activeIdx}`}
          selection={selections[activeIdx]}
          otherActive={otherActive[activeIdx] ?? false}
          customText={customTexts[activeIdx] ?? ""}
          disabled={busy}
          onTogglePreset={togglePreset}
          onToggleOther={toggleOther}
          onCustomTextChange={(text) => setCustomTexts((prev) => ({ ...prev, [activeIdx]: text }))}
          onPrimaryActionShortcut={runPrimaryAction}
        />
      </div>

      <div className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-px-3 tw-py-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy || (isFinalQuestion ? !canSubmit : !canAdvance)}
          onClick={runPrimaryAction}
        >
          {isFinalQuestion ? "Submit" : "Next"}
        </Button>
      </div>
    </div>
  );
};

interface QuestionPanelProps {
  question: AgentQuestion;
  name: string;
  selection: string | Set<string> | undefined;
  otherActive: boolean;
  customText: string;
  disabled: boolean;
  onTogglePreset: (label: string) => void;
  onToggleOther: () => void;
  onCustomTextChange: (text: string) => void;
  onPrimaryActionShortcut: () => void;
}

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
  onPrimaryActionShortcut,
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

        {question.allowOther !== false ? (
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
        ) : null}
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
              onPrimaryActionShortcut();
            }
          }}
          rows={2}
        />
      ) : null}
    </div>
  );
};
