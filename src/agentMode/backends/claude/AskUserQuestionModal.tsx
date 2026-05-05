import { Button } from "@/components/ui/button";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import type { AskUserQuestionInput } from "@/agentMode/sdk/permissionBridge";

type Questions = AskUserQuestionInput["questions"];
type Answers = { [questionText: string]: string };

interface ContentProps {
  questions: Questions;
  onSubmit: (answers: Answers) => void;
  onCancel: () => void;
}

/**
 * Modal that renders the SDK's `AskUserQuestion` payload as a series of
 * single- or multi-choice question blocks. Resolves with `{ questionText:
 * "label" }` (single-select) or `{ questionText: "label1, label2" }`
 * (multi-select). Closing without submitting resolves with `{}` — the
 * permission bridge treats an empty answer map as a cancellation.
 */
const AskUserQuestionContent: React.FC<ContentProps> = ({ questions, onSubmit, onCancel }) => {
  // Per-question selection: a single label for radio, a Set of labels for checkbox.
  const [selections, setSelections] = React.useState<Record<number, string | Set<string>>>({});

  const canSubmit = questions.every((q, idx) => {
    if (q.multiSelect) return true;
    return typeof selections[idx] === "string" && selections[idx] !== "";
  });

  const submit = (): void => {
    const answers: Answers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections[i];
      if (q.multiSelect) {
        answers[q.question] = sel instanceof Set ? Array.from(sel).join(", ") : "";
      } else {
        answers[q.question] = typeof sel === "string" ? sel : "";
      }
    }
    onSubmit(answers);
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {questions.map((q, idx) => (
        <div key={idx} className="tw-flex tw-flex-col tw-gap-2">
          {q.header && (
            <div className="tw-text-xs tw-font-semibold tw-uppercase tw-text-muted">{q.header}</div>
          )}
          <div className="tw-text-sm">{q.question}</div>
          <div className="tw-flex tw-flex-col tw-gap-1">
            {q.options.map((opt) => {
              const sel = selections[idx];
              const checked = q.multiSelect
                ? sel instanceof Set && sel.has(opt.label)
                : sel === opt.label;
              return (
                <label
                  key={opt.label}
                  className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2 tw-rounded tw-px-2 tw-py-1 hover:tw-bg-modifier-hover"
                >
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`askq-${idx}`}
                    checked={checked}
                    onChange={() => {
                      setSelections((prev) => {
                        if (q.multiSelect) {
                          const cur = prev[idx];
                          const next = new Set(cur instanceof Set ? cur : []);
                          if (next.has(opt.label)) next.delete(opt.label);
                          else next.add(opt.label);
                          return { ...prev, [idx]: next };
                        }
                        return { ...prev, [idx]: opt.label };
                      });
                    }}
                    className="tw-mt-0.5"
                  />
                  <div className="tw-min-w-0">
                    <div className="tw-text-sm">{opt.label}</div>
                    {opt.description && (
                      <div className="tw-text-xs tw-text-muted">{opt.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="tw-mt-2 tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={submit} disabled={!canSubmit}>
          Submit
        </Button>
      </div>
    </div>
  );
};

/**
 * Open the AskUserQuestion modal for one Claude SDK `canUseTool` invocation.
 * Resolves with the answers map (or `{}` on cancel — the bridge maps empty
 * to a deny-with-cancelled message).
 */
export function openAskUserQuestionModal(app: App, questions: Questions): Promise<Answers> {
  return new Promise((resolve) => {
    const modal = new AskUserQuestionModal(app, questions, resolve);
    modal.open();
  });
}

class AskUserQuestionModal extends Modal {
  private root: Root | null = null;
  private settled = false;

  constructor(
    app: App,
    private readonly questions: Questions,
    private readonly onSettle: (answers: Answers) => void
  ) {
    super(app);
    this.setTitle("Agent Mode — Question from Claude");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.root = createRoot(contentEl);
    this.root.render(
      <AskUserQuestionContent
        questions={this.questions}
        onSubmit={(answers) => {
          this.settled = true;
          this.onSettle(answers);
          this.close();
        }}
        onCancel={() => {
          this.settled = true;
          this.onSettle({});
          this.close();
        }}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.onSettle({});
    }
  }
}
