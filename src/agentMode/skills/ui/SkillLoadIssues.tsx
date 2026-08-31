import { Button } from "@/components/ui/button";
import React from "react";

export interface SkillLoadIssue {
  name: string;
  location: string;
  reason: string;
  suggestion?: string;
  revealLabel: "Reveal in vault" | "Show in folder";
  onOpen: () => void;
  onReveal: () => void;
}

export interface SkillLoadIssuesProps {
  issues: readonly SkillLoadIssue[];
}

/**
 * Persistent recovery surface for discovered SKILL.md files that cannot load.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/166
 */
export const SkillLoadIssues: React.FC<SkillLoadIssuesProps> = ({ issues }) => {
  const title = `${issues.length} skill${issues.length === 1 ? "" : "s"} could not be loaded`;

  return (
    <section className="skill-load-issues" role="alert" aria-label={title}>
      <strong className="skill-load-title">{title}</strong>
      <p className="skill-load-intro">Fix their SKILL.md files to make them available to agents.</p>

      <div className="skill-load-list">
        {issues.map((issue) => (
          <article className="skill-load-item" key={issue.location}>
            <strong className="skill-load-name">{issue.name}</strong>
            <span className="skill-load-path">{issue.location}</span>
            <p className="skill-load-reason">{issue.reason}</p>
            {issue.suggestion !== undefined && (
              <code className="skill-load-fix">{issue.suggestion}</code>
            )}
            <div className="skill-load-actions">
              <Button variant="secondary" size="sm" onClick={issue.onOpen}>
                Open SKILL.md
              </Button>
              <Button variant="secondary" size="sm" onClick={issue.onReveal}>
                {issue.revealLabel}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

/** Empty loaded-list copy shown when every discovered skill needs repair. */
export const AllSkillsNotLoaded: React.FC = () => (
  <div className="skill-list-empty">
    No skills are loaded yet. Fix a SKILL.md above; when it loads successfully, it will move into
    the loaded list.
  </div>
);
