import {
  AgentHomeCreateRow,
  AgentHomeListRow,
  AgentHomePreviewList,
} from "@/agentMode/ui/AgentHomeSection";
import { AgentProjectRowActions } from "@/agentMode/ui/AgentProjectRowActions";
import { ProjectConfig } from "@/aiParams";
import { SearchBar } from "@/components/ui/SearchBar";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { useIncrementalPaging } from "@/hooks/useIncrementalPaging";
import { useRecentUsageManagerRevision } from "@/hooks/useRecentUsageManagerRevision";
import { cn } from "@/lib/utils";
import { filterProjects } from "@/utils/projectUtils";
import { RecentUsageManager, sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { App } from "obsidian";
import React, { memo, useMemo, useState } from "react";

const LANDING_SORT_STRATEGY: SortStrategy = "recent";

interface ProjectPickerListProps {
  projects: ProjectConfig[];
  onSelect: (project: ProjectConfig) => void;
  onCreate?: (anchor: HTMLElement) => void;
  app: App;
  onProjectDeleted?: (projectId: string) => void;
  projectUsageTimestampsManager?: RecentUsageManager<string>;
  className?: string;
}

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
    icon={ProjectFolderIcon}
    trailing={<AgentProjectRowActions app={app} project={project} onDeleted={onDeleted} />}
  />
));
ProjectRow.displayName = "ProjectRow";

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
    const filteredProjects = useMemo(
      () => filterProjects(sortedProjects, searchQuery),
      [sortedProjects, searchQuery]
    );
    const { displayCount, sentinelRef } = useIncrementalPaging(
      filteredProjects.length,
      searchQuery
    );
    const visibleProjects = filteredProjects.slice(0, displayCount);

    return (
      <div
        className={cn(
          "tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-divide-y tw-divide-border",
          className
        )}
      >
        {onCreate && <AgentHomeCreateRow label="New project" onClick={onCreate} />}
        {projects.length > 0 && (
          <div className="tw-p-1">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search projects..."
              inputClassName="!tw-h-7"
            />
          </div>
        )}
        {filteredProjects.length === 0 ? (
          <div className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">
            {projects.length > 0 ? "No matching projects" : "No projects available"}
          </div>
        ) : (
          <AgentHomePreviewList>
            <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
              {visibleProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  timeMs={effectiveLastUsedMs(project, projectUsageTimestampsManager)}
                  onSelect={onSelect}
                  app={app}
                  onDeleted={onProjectDeleted}
                />
              ))}
              {displayCount < filteredProjects.length && (
                <div ref={sentinelRef} className="tw-h-1" aria-hidden="true" />
              )}
            </div>
          </AgentHomePreviewList>
        )}
      </div>
    );
  }
);

ProjectPickerList.displayName = "ProjectPickerList";
