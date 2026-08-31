import { Button } from "@/components/ui/button";
import { ReactModal } from "@/components/modals/ReactModal";
import { App } from "obsidian";
import React from "react";

export interface SkillLoadIssue {
  location: string;
  reason: string;
  offendingText?: string;
  revealLabel: "Reveal in vault" | "Show in folder";
  onOpen: () => void;
  onReveal: () => void;
}

export interface SkillLoadIssuesProps {
  issues: readonly SkillLoadIssue[];
  onViewDetails: () => void;
}

const UNQUOTED_DESCRIPTION_REASON = 'The description contains ": " and must be quoted.';

/**
 * Compact recovery alert for discovered SKILL.md files that cannot load.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/166
 */
export const SkillLoadIssues: React.FC<SkillLoadIssuesProps> = ({ issues, onViewDetails }) => {
  const title = `${issues.length} skill${issues.length === 1 ? "" : "s"} could not be loaded`;
  const sharedReason = issues.every((issue) => issue.reason === issues[0]?.reason)
    ? issues[0]?.reason
    : undefined;
  const summary =
    sharedReason === undefined
      ? "Not available to agents. Their SKILL.md files have different format errors."
      : sharedReason === UNQUOTED_DESCRIPTION_REASON
        ? `Not available to agents. ${issues.length === 1 ? "The description is not quoted." : "All have an unquoted description."}`
        : `Not available to agents. ${issues.length === 1 ? "Its SKILL.md has a format error." : "All have the same SKILL.md format error."}`;

  return (
    <section className="skill-load-issues" role="alert" aria-label={title}>
      <strong className="skill-load-title">{title}</strong>
      <p className="skill-load-intro">{summary}</p>
      <div className="skill-load-actions">
        <Button variant="secondary" size="sm" onClick={onViewDetails}>
          View details
        </Button>
      </div>
    </section>
  );
};

export interface SkillLoadIssuesModalContentProps {
  issues: readonly SkillLoadIssue[];
  onClose: () => void;
}

/** Complete repair list rendered inside the native details modal. */
export const SkillLoadIssuesModalContent: React.FC<SkillLoadIssuesModalContentProps> = ({
  issues,
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
    <div className="skill-load-list">
      {issues.map((issue) => (
        <article className="skill-load-item" key={issue.location}>
          <div className="skill-load-path">{issue.location}</div>
          <p className="skill-load-reason">{issue.reason}</p>
          {issue.offendingText !== undefined && (
            <code className="skill-load-code">{issue.offendingText}</code>
          )}
          <div className="skill-load-actions">
            <Button variant="secondary" size="sm" onClick={() => runAction(issue.onOpen)}>
              Open SKILL.md
            </Button>
            <Button variant="secondary" size="sm" onClick={() => runAction(issue.onReveal)}>
              {issue.revealLabel}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
};

/** Native Obsidian modal containing every rejected skill and repair action. */
export class SkillLoadIssuesModal extends ReactModal {
  constructor(
    app: App,
    private readonly issues: readonly SkillLoadIssue[]
  ) {
    super(app, `${issues.length} skill${issues.length === 1 ? "" : "s"} could not be loaded`);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <SkillLoadIssuesModalContent issues={this.issues} onClose={close} />;
  }
}

/** Empty loaded-list copy shown when every discovered skill needs repair. */
export const AllSkillsNotLoaded: React.FC = () => (
  <div className="skill-list-empty">
    No skills are loaded yet. Choose View details above to repair a SKILL.md. When it loads
    successfully, it will move into the loaded list.
  </div>
);
