import {
  AgentHomeListRow,
  AgentHomeSection,
  AgentHomeViewAll,
  INLINE_LIMIT,
} from "@/agentMode/ui/AgentHomeSection";
import { ProjectConfig } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { filterProjects } from "@/utils/projectUtils";
import { sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { Folder, Plus } from "lucide-react";
import React, { memo, useMemo, useState } from "react";

// Reason: PR1 is strictly read-only — surface a fixed sort (most-recently-used first)
// without exposing a switcher or writing the strategy back to settings.
const READ_ONLY_SORT_STRATEGY: SortStrategy = "recent";

interface ProjectPickerListProps {
  /** Full project list (already reactive from useProjects upstream). */
  projects: ProjectConfig[];
  /** Caller-owned selection handler. In PR1 core wires this to a coming-soon Notice. */
  onSelect: (project: ProjectConfig) => void;
  /**
   * Optional header create action. When provided, a "+" button renders in the
   * section header. PR1 wires this to a coming-soon Notice (no project CRUD).
   */
  onCreate?: () => void;
  className?: string;
}

/** Stable read-only ordering shared by the inline list and the View-all popover. */
function useSortedProjects(projects: ProjectConfig[]): ProjectConfig[] {
  return useMemo(
    () =>
      sortByStrategy(projects, READ_ONLY_SORT_STRATEGY, {
        getName: (project) => project.name,
        getCreatedAtMs: (project) => project.created,
        getLastUsedAtMs: (project) => project.UsageTimestamps,
      }),
    [projects]
  );
}

interface ProjectRowProps {
  project: ProjectConfig;
  onSelect: (project: ProjectConfig) => void;
  /** Inline rows indent under the section title; popover rows don't. */
  indent?: boolean;
}

const ProjectRow = memo(({ project, onSelect, indent }: ProjectRowProps) => (
  <AgentHomeListRow
    label={project.name}
    timeMs={project.UsageTimestamps || project.created}
    onClick={() => onSelect(project)}
    indent={indent}
  />
));
ProjectRow.displayName = "ProjectRow";

/**
 * Read-only project browser for the Agent Home landing (design A.2 + B.2).
 *
 * Shows the {@link INLINE_LIMIT} most-recent projects inline with a "View all
 * projects" affordance opening an in-pane search popover (not a fullscreen
 * modal). Selection and the optional create action are delegated to the caller;
 * this component never mutates project state, usage, or current-project.
 */
export const ProjectPickerList = memo(
  ({ projects, onSelect, onCreate, className }: ProjectPickerListProps): React.ReactElement => {
    const [searchQuery, setSearchQuery] = useState("");

    const sortedProjects = useSortedProjects(projects);
    const inlineProjects = useMemo(() => sortedProjects.slice(0, INLINE_LIMIT), [sortedProjects]);

    const total = projects.length;
    const hasOverflow = total > INLINE_LIMIT;

    return (
      <AgentHomeSection
        className={className}
        icon={<Folder className="tw-size-4 tw-text-muted" />}
        title="Projects"
        count={total}
        action={
          onCreate ? (
            <Button
              variant="ghost2"
              size="icon"
              className="tw-size-6 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
              onClick={onCreate}
              aria-label="New project"
            >
              <Plus className="tw-size-4" />
            </Button>
          ) : undefined
        }
      >
        {total === 0 ? (
          <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No projects available</div>
        ) : (
          <div className="tw-flex tw-flex-col tw-gap-0.5">
            {inlineProjects.map((project) => (
              <ProjectRow key={project.id} project={project} onSelect={onSelect} indent />
            ))}

            {hasOverflow && (
              <AgentHomeViewAll
                items={sortedProjects}
                total={total}
                label="projects"
                popoverTitle="All projects"
                searchValue={searchQuery}
                onSearch={setSearchQuery}
                filter={filterProjects}
                searchPlaceholder="Search projects"
                emptyMessage="No matching projects"
                renderRow={(project, close) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    onSelect={(selected) => {
                      onSelect(selected);
                      close();
                    }}
                  />
                )}
              />
            )}
          </div>
        )}
      </AgentHomeSection>
    );
  }
);

ProjectPickerList.displayName = "ProjectPickerList";
