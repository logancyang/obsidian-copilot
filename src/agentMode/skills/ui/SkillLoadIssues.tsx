import { Button } from "@/components/ui/button";
import { ClampedContent } from "@/components/ui/clamped-content";
import { ReactModal } from "@/components/modals/ReactModal";
import { App } from "obsidian";
import React from "react";

export interface SkillLoadIssue {
  location: string;
  reason: string;
  offendingText?: string;
  revealLabel: "Reveal in vault" | "Show in folder";
  onFixWithAgent: () => void;
  onOpen: () => void;
  onReveal: () => void;
}

export interface SkillLoadIssuesProps {
  issues: readonly SkillLoadIssue[];
  onViewDetails: () => void;
}

/**
 * Compact recovery alert for discovered SKILL.md files that cannot load.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/166
 */
export const SkillLoadIssues: React.FC<SkillLoadIssuesProps> = ({ issues, onViewDetails }) => {
  const title = `${issues.length} skill${issues.length === 1 ? "" : "s"} could not be loaded`;

  return (
    <section
      className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-rounded-sm tw-border tw-border-solid tw-p-3 tw-text-ui-smaller tw-bg-warning/10 tw-border-warning/40"
      role="alert"
      aria-label={title}
    >
      <div className="tw-min-w-0">
        <strong className="tw-block tw-text-ui-small tw-text-warning">{title}</strong>
        <p className="tw-mx-0 tw-mb-0 tw-mt-0.5 tw-text-normal">The skills have format errors.</p>
      </div>
      <div className="tw-flex tw-shrink-0 tw-gap-1">
        <Button variant="secondary" size="sm" onClick={onViewDetails}>
          View details
        </Button>
      </div>
    </section>
  );
};

export interface SkillLoadIssuesModalContentProps {
  issues: readonly SkillLoadIssue[];
  onFixAll: () => void;
  onClose: () => void;
}

/** Complete repair list rendered inside the native details modal. */
export const SkillLoadIssuesModalContent: React.FC<SkillLoadIssuesModalContentProps> = ({
  issues,
  onFixAll,
  onClose,
}) => {
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  // Close first so Obsidian does not open an indexed file behind this modal,
  // and returning from an external editor can trigger the Settings focus refresh.
  const runAction = (action: () => void): void => {
    onClose();
    action();
  };

  return (
    <>
      {issues.length > 1 && (
        <div className="tw-flex tw-justify-end">
          <Button size="sm" onClick={() => runAction(onFixAll)}>
            Fix All with Agent
          </Button>
        </div>
      )}
      <div className="tw-mt-3 tw-max-h-96 tw-overflow-y-auto tw-pr-1">
        {issues.map((issue) => (
          <article
            className="tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-py-3 tw-border-warning/30"
            key={issue.location}
          >
            <div className="tw-break-words tw-font-mono tw-text-ui-small tw-font-semibold tw-text-normal">
              {issue.location}
            </div>
            <p className="tw-mx-0 tw-mb-0 tw-mt-1 tw-text-ui-smaller tw-text-muted">
              {issue.reason}
            </p>
            {issue.offendingText !== undefined && (
              <ClampedContent collapsedClassName="tw-max-h-28">
                <code className="tw-mt-1 tw-block tw-whitespace-pre-wrap tw-rounded-sm tw-bg-primary-alt tw-p-1 tw-text-smallest">
                  {issue.offendingText}
                </code>
              </ClampedContent>
            )}
            <div className="tw-mt-2 tw-flex tw-gap-1">
              <Button variant="secondary" size="sm" onClick={() => runAction(issue.onFixWithAgent)}>
                Fix with Agent
              </Button>
              <Button variant="ghost2" size="sm" onClick={() => runAction(issue.onOpen)}>
                Open SKILL.md
              </Button>
              <Button variant="ghost2" size="sm" onClick={() => runAction(issue.onReveal)}>
                {issue.revealLabel}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

/** Native Obsidian modal containing every rejected skill and repair action. */
export class SkillLoadIssuesModal extends ReactModal {
  constructor(
    app: App,
    private readonly issues: readonly SkillLoadIssue[],
    private readonly onFixAll: () => void
  ) {
    super(app, `${issues.length} skill${issues.length === 1 ? "" : "s"} could not be loaded`);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <SkillLoadIssuesModalContent issues={this.issues} onFixAll={this.onFixAll} onClose={close} />
    );
  }
}

/** Empty loaded-list copy shown when every discovered skill needs repair. */
export const AllSkillsNotLoaded: React.FC = () => (
  <div className="tw-rounded-sm tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
    No skills are loaded yet. Choose View details above to repair a SKILL.md. When it loads
    successfully, it will move into the loaded list.
  </div>
);
