import {
  AgentHomeCreateRow,
  AgentHomeListRow,
  AgentHomeViewAll,
  INLINE_LIMIT,
} from "@/agentMode/ui/AgentHomeSection";
import { ProjectConfig } from "@/aiParams";
import { cn } from "@/lib/utils";
import { filterProjects } from "@/utils/projectUtils";
import { sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { Folder } from "lucide-react";
import React, { memo, useMemo, useState } from "react";

// Reason: PR1 is strictly read-only — surface a fixed sort (most-recently-used first)
// without exposing a switcher or writing the strategy back to settings.
const READ_ONLY_SORT_STRATEGY: SortStrategy = "recent";

// Stable per-project accent: hash the id into one of six theme hues so a project
// keeps the same color across renders and sessions (Math.random would reshuffle
// every paint). Each entry pairs a solid `text` hue with its soft `bg` tint from
// the `project` palette in tailwind.config — the folder glyph inherits the text
// color, the tile shows the tint behind it.
const PROJECT_ICON_PALETTE = [
  "tw-text-project-red tw-bg-project-red",
  "tw-text-project-orange tw-bg-project-orange",
  "tw-text-project-yellow tw-bg-project-yellow",
  "tw-text-project-green tw-bg-project-green",
  "tw-text-project-blue tw-bg-project-blue",
  "tw-text-project-purple tw-bg-project-purple",
] as const;

function projectIconClasses(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // clamp to 32-bit so long ids stay deterministic
  }
  return PROJECT_ICON_PALETTE[Math.abs(hash) % PROJECT_ICON_PALETTE.length];
}

/** Tinted square + colored folder, stable per project id. */
const ProjectIconTile = memo(({ id }: { id: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      "tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md",
      projectIconClasses(id)
    )}
  >
    <Folder className="tw-size-4" />
  </span>
));
ProjectIconTile.displayName = "ProjectIconTile";

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

/**
 * Stable read-only ordering shared by the inline list and the View-all popover.
 *
 * DESIGN NOTE: sorts on the persisted `project.UsageTimestamps` only — it does
 * NOT blend in-memory touches via `RecentUsageManager.getEffectiveLastUsedAt`
 * the way the main chat-mode `ProjectList` does. This landing surface is
 * read-only: picking a project only fires a coming-soon Notice and never
 * touches usage, so the two lists diverge only in a narrow cross-surface race —
 * use a project in chat mode, then open Agent Home before the persisted
 * timestamp / file-backed project list catches up. Parity would mean threading
 * the project usage manager + a
 * `useSyncExternalStore` revision subscription into this deliberately minimal
 * read-only component; that cost outweighs the low-probability stale recency.
 * Accepted as consistency debt to resolve when the landing becomes interactive
 * (projects can be entered/touched here) by extracting a shared recency hook. If
 * a future review flags the divergence again, point them at this note.
 */
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
}

const ProjectRow = memo(({ project, onSelect }: ProjectRowProps) => (
  <AgentHomeListRow
    label={project.name}
    timeMs={project.UsageTimestamps || project.created}
    onClick={() => onSelect(project)}
    leading={<ProjectIconTile id={project.id} />}
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
      <div className={cn("tw-flex tw-flex-col tw-divide-y tw-divide-border", className)}>
        {onCreate && <AgentHomeCreateRow label="New project" onClick={onCreate} />}
        {total === 0 ? (
          <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No projects available</div>
        ) : (
          <>
            {inlineProjects.map((project) => (
              <ProjectRow key={project.id} project={project} onSelect={onSelect} />
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
          </>
        )}
      </div>
    );
  }
);

ProjectPickerList.displayName = "ProjectPickerList";
