import {
  AgentHomeCreateRow,
  AgentHomeListRow,
  AgentHomeViewAll,
  INLINE_LIMIT,
} from "@/agentMode/ui/AgentHomeSection";
import { AgentProjectRowActions } from "@/agentMode/ui/AgentProjectRowActions";
import { ProjectIconTile } from "@/agentMode/ui/ProjectIconTile";
import { ProjectConfig } from "@/aiParams";
import { useRecentUsageManagerRevision } from "@/hooks/useRecentUsageManagerRevision";
import { cn } from "@/lib/utils";
import { filterProjects } from "@/utils/projectUtils";
import { RecentUsageManager, sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { App } from "obsidian";
import React, { memo, useMemo, useState } from "react";

// Reason: the landing surfaces a fixed most-recently-used order with no switcher
// and never writes the strategy back to settings.
const LANDING_SORT_STRATEGY: SortStrategy = "recent";

interface ProjectPickerListProps {
  /** Full project list (already reactive from useProjects upstream). */
  projects: ProjectConfig[];
  /** Caller-owned selection handler. PR2a wires this to `enterProject`. */
  onSelect: (project: ProjectConfig) => void;
  /**
   * Optional create action, rendered as the leading "New project" row. Receives
   * the row's button element so the caller can anchor the create popover to it.
   */
  onCreate?: (anchor: HTMLElement) => void;
  /** Threaded to each row's inline actions (Reveal / Edit / Delete). */
  app: App;
  /** Forwarded to the row actions so the caller can exit a deleted active scope. */
  onProjectDeleted?: (projectId: string) => void;
  /**
   * Shared in-memory usage manager. Blended into the sort + row time so entering a
   * project reorders the list immediately, ahead of the throttled disk persist.
   */
  projectUsageTimestampsManager?: RecentUsageManager<string>;
  className?: string;
}

/**
 * Effective last-used time for a project: the in-memory value (if more recent than
 * the persisted one) so a just-entered project sorts/displays as most-recent before
 * its timestamp persists, falling back to `created` when never used.
 */
function effectiveLastUsedMs(
  project: ProjectConfig,
  manager: RecentUsageManager<string> | undefined
): number {
  return (
    manager?.getEffectiveLastUsedAt(project.id, project.UsageTimestamps) ||
    project.UsageTimestamps ||
    project.created
  );
}

/**
 * Most-recently-used ordering shared by the inline list and the View-all popover.
 *
 * The landing is interactive — entering a project touches its usage — so this blends
 * the in-memory {@link RecentUsageManager} via `getEffectiveLastUsedAt` exactly like
 * the chat-mode `ProjectList`, and both read the SAME shared manager instance. The
 * revision subscription drives a re-sort when memory changes between throttled
 * persists, so a just-entered project jumps to the top before its timestamp lands on
 * disk.
 */
function useSortedProjects(
  projects: ProjectConfig[],
  manager: RecentUsageManager<string> | undefined
): ProjectConfig[] {
  const revision = useRecentUsageManagerRevision(manager);
  return useMemo(
    () =>
      sortByStrategy(projects, LANDING_SORT_STRATEGY, {
        getName: (project) => project.name,
        getCreatedAtMs: (project) => project.created,
        getLastUsedAtMs: (project) =>
          manager?.getEffectiveLastUsedAt(project.id, project.UsageTimestamps) ??
          project.UsageTimestamps,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers re-sort when the manager's in-memory state changes
    [projects, manager, revision]
  );
}

interface ProjectRowProps {
  project: ProjectConfig;
  /**
   * Effective last-used time, computed by the parent. Passed as a prop (not read
   * from `project` here) so this `memo`'d row re-renders when only the in-memory
   * time changes — the project reference itself stays stable across a touch.
   */
  timeMs: number;
  onSelect: (project: ProjectConfig) => void;
  app: App;
  onDeleted?: (projectId: string) => void;
}

const ProjectRow = memo(({ project, timeMs, onSelect, app, onDeleted }: ProjectRowProps) => (
  <AgentHomeListRow
    label={project.name}
    timeMs={timeMs}
    onClick={() => onSelect(project)}
    leading={<ProjectIconTile id={project.id} />}
    trailing={<AgentProjectRowActions app={app} project={project} onDeleted={onDeleted} />}
  />
));
ProjectRow.displayName = "ProjectRow";

/**
 * Project browser for the Agent Home landing (design A.2 + B.2).
 *
 * Shows the {@link INLINE_LIMIT} most-recent projects inline with a "View all
 * projects" affordance opening an in-pane search popover (not a fullscreen
 * modal). Selection and the optional create action are delegated to the caller;
 * this component never mutates project state directly. Entering a project (via the
 * caller) touches usage on the shared manager, which reorders this list live.
 */
export const ProjectPickerList = memo(
  ({
    projects,
    onSelect,
    onCreate,
    app,
    onProjectDeleted,
    projectUsageTimestampsManager,
    className,
  }: ProjectPickerListProps): React.ReactElement => {
    const [searchQuery, setSearchQuery] = useState("");

    const sortedProjects = useSortedProjects(projects, projectUsageTimestampsManager);
    const inlineProjects = useMemo(() => sortedProjects.slice(0, INLINE_LIMIT), [sortedProjects]);

    const total = projects.length;
    const hasOverflow = total > INLINE_LIMIT;

    return (
      // tw-grow fills the shelf panel's fixed floor (AgentHomeShelf) so the
      // empty-state copy below can center inside the card; the "New project"
      // action row stays pinned at the top either way.
      <div className={cn("tw-flex tw-grow tw-flex-col tw-divide-y tw-divide-border", className)}>
        {onCreate && <AgentHomeCreateRow label="New project" onClick={onCreate} />}
        {total === 0 ? (
          <div className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">
            No projects available
          </div>
        ) : (
          <>
            {inlineProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                timeMs={effectiveLastUsedMs(project, projectUsageTimestampsManager)}
                onSelect={onSelect}
                app={app}
                onDeleted={onProjectDeleted}
              />
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
                    timeMs={effectiveLastUsedMs(project, projectUsageTimestampsManager)}
                    onSelect={(selected) => {
                      onSelect(selected);
                      close();
                    }}
                    app={app}
                    onDeleted={onProjectDeleted}
                  />
                )}
              />
            )}
          </>
        )}
      </div>
    );
  }
);

ProjectPickerList.displayName = "ProjectPickerList";
