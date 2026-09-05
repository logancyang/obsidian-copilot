import {
  AgentHomeCreateRow,
  AgentHomeListRow,
  AgentHomePreviewList,
} from "@/agentMode/ui/AgentHomeSection";
import { AgentProjectRowActions } from "@/agentMode/ui/AgentProjectRowActions";
import { ProjectConfig } from "@/aiParams";
import { SearchBar } from "@/components/ui/SearchBar";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { useRecentUsageManagerRevision } from "@/hooks/useRecentUsageManagerRevision";
import { cn } from "@/lib/utils";
import { filterProjects } from "@/utils/projectUtils";
import { RecentUsageManager, sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { App } from "obsidian";
import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

// Reason: the landing surfaces a fixed most-recently-used order with no switcher
// and never writes the strategy back to settings.
const LANDING_SORT_STRATEGY: SortStrategy = "recent";
const PAGE_SIZE = 50;

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
 * Most-recently-used ordering for the project list.
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
    icon={ProjectFolderIcon}
    trailing={<AgentProjectRowActions app={app} project={project} onDeleted={onDeleted} />}
  />
));
ProjectRow.displayName = "ProjectRow";

/**
 * Searchable project browser for the Agent Home landing.
 *
 * Searches the full collection and mounts rows in batches as the list scrolls.
 * Selection and the optional create action are delegated to the caller; this
 * component never mutates project state directly. Entering a project (via the
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

    const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const sortedProjects = useSortedProjects(projects, projectUsageTimestampsManager);
    const filteredProjects = useMemo(
      () => filterProjects(sortedProjects, searchQuery),
      [sortedProjects, searchQuery]
    );
    const visibleProjects = filteredProjects.slice(0, displayCount);

    // Search covers every project while each new query starts with bounded rows.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
    useLayoutEffect(() => {
      setDisplayCount(PAGE_SIZE);
    }, [searchQuery]);

    const sentinelRef = useCallback(
      (node: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        // Disconnect when filtering removes the sentinel or the list unmounts.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
        if (!node) return;
        const IntersectionObserverConstructor =
          node.ownerDocument.defaultView?.IntersectionObserver ?? IntersectionObserver;
        const observer = new IntersectionObserverConstructor(
          (entries) => {
            // Mount another bounded page only when scrolling reaches the end.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
            if (!entries[0]?.isIntersecting) return;
            setDisplayCount((current) => Math.min(current + PAGE_SIZE, filteredProjects.length));
          },
          { threshold: 0.1 }
        );
        observer.observe(node);
        observerRef.current = observer;
      },
      [filteredProjects.length]
    );

    return (
      // h-full fills the shelf panel's fixed floor (AgentHomeShelf) so the
      // empty-state copy below can center inside the card; the "New project"
      // action row stays pinned at the top either way.
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
        {/* Keep empty and no-match states in the same shelf as project search.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/372 */}
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
