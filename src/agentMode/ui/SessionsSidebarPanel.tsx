import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { SessionsSidebarFolderRow } from "@/agentMode/ui/SessionsSidebarFolderRow";
import {
  SessionsSidebarRow,
  mostUrgentStatus,
  resolveSessionStatus,
} from "@/agentMode/ui/SessionsSidebarRow";
import {
  RECENTS_PAGE_SIZE,
  VISIBLE_CHATS_PER_PROJECT,
  VISIBLE_PROJECTS,
  filterChatsByTitle,
  groupSessionsSidebarChats,
} from "@/agentMode/ui/sessionsSidebarGroups";
import type { ProjectConfig } from "@/aiParams";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { SearchBar } from "@/components/ui/SearchBar";
import { useIncrementalPaging } from "@/hooks/useIncrementalPaging";
import { cn } from "@/lib/utils";
import { Archive, ChevronRight, MoreHorizontal, Search, SquarePen } from "lucide-react";
import React, { useCallback, useId, useMemo, useState } from "react";

interface SessionsSidebarPanelProps {
  items: readonly ChatHistoryItem[];
  projects: readonly ProjectConfig[];
  expandedProjectIds: ReadonlySet<string>;
  activeChatIds: ReadonlySet<string>;
  runningChatIds: ReadonlySet<string>;
  waitingChatIds: ReadonlySet<string>;
  attentionChatIds: ReadonlySet<string>;
  openChatIds: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (groupId: string) => void;
  actions: RecentChatActions;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onToggleProject: (projectId: string) => void;
  onProjectDeleted: (projectId: string) => void;
  onViewArchived: () => void;
}

interface GroupProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const Group: React.FC<GroupProps> = ({ title, collapsed, onToggle, children }) => {
  const headerId = useId();
  return (
    // Obsidian shows an aria-label as a hover tooltip, so the section takes its name from the header instead.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/802
    <section aria-labelledby={headerId} className="tw-flex tw-flex-col tw-gap-0.5">
      <h3 className="tw-group tw-m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={cn(
            "clickable-icon tw-flex tw-h-auto tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-bg-transparent",
            "tw-px-2 tw-pb-1 tw-pt-2 tw-text-left tw-text-xs tw-font-medium tw-text-muted tw-shadow-none"
          )}
        >
          <span className="tw-min-w-0 tw-flex-1 tw-truncate">{title}</span>
          {/* The fold chevron shows only on hover or focus, like the header's other actions, so the list reads clean.
              https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
          <ChevronRight
            className={cn(
              "tw-invisible tw-size-4 tw-shrink-0 group-focus-within:tw-visible group-hover:tw-visible",
              !collapsed && "tw-rotate-90"
            )}
          />
        </button>
      </h3>
      {!collapsed && children}
    </section>
  );
};

const ShowMoreButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    type="button"
    variant="ghost2"
    size="sm"
    className="tw-h-7 tw-justify-start tw-px-2 tw-text-muted"
    onClick={onClick}
  >
    Show more
  </Button>
);

export const SessionsSidebarPanel: React.FC<SessionsSidebarPanelProps> = ({
  items,
  projects,
  expandedProjectIds,
  activeChatIds,
  runningChatIds,
  waitingChatIds,
  attentionChatIds,
  openChatIds,
  collapsedGroups,
  onToggleGroup,
  actions,
  onNewChat,
  onOpenChat,
  onToggleProject,
  onProjectDeleted,
  onViewArchived,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allProjectsShown, setAllProjectsShown] = useState(false);
  const [fullyShownProjectIds, setFullyShownProjectIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const groups = useMemo(() => groupSessionsSidebarChats(items, projects), [items, projects]);
  const projectNamesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const matches = useMemo(
    () => (query.trim() ? filterChatsByTitle(items, query) : null),
    [items, query]
  );
  const { displayCount, sentinelRef } = useIncrementalPaging(
    groups.recents.length,
    "",
    RECENTS_PAGE_SIZE
  );

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    setQuery("");
  }, []);

  const statusOf = (item: ChatHistoryItem) =>
    resolveSessionStatus({
      waiting: waitingChatIds.has(item.id),
      unread: attentionChatIds.has(item.id),
      running: runningChatIds.has(item.id),
    });

  const renderChat = (item: ChatHistoryItem, labelProject = false) => (
    <SessionsSidebarRow
      key={item.id}
      item={item}
      status={statusOf(item)}
      active={activeChatIds.has(item.id)}
      isSessionOpen={openChatIds.has(item.id)}
      projectName={
        labelProject && item.projectId ? projectNamesById.get(item.projectId) : undefined
      }
      actions={actions}
      onSelect={() => onOpenChat(item.id)}
    />
  );

  const visibleProjects = allProjectsShown
    ? groups.projects
    : groups.projects.slice(0, VISIBLE_PROJECTS);

  return (
    <div className="tw-flex tw-size-full tw-min-h-0 tw-flex-col tw-gap-2 tw-p-2">
      <div className="tw-flex tw-items-center tw-gap-1 tw-@container/sidebar-header">
        <h2 className="tw-m-0 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1 tw-pl-2 tw-text-ui-medium tw-font-semibold tw-text-normal">
          <CopilotBrandIcon className="tw-size-5 tw-shrink-0" />
          <span className="tw-truncate">Copilot</span>
        </h2>
        {/* New chat keeps its label while the header has room, down to Obsidian's default sidebar width, and drops to its icon
            in a narrower sidebar; the label stays as its screen-reader name, since an aria-label would show as a tooltip.
            Obsidian's grey focus shadow beats the Button ring and barely shows beside the accent fill, so focus adds an outline.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <Button
          variant="default"
          className={cn(
            "tw-h-7 tw-shrink-0 tw-gap-1.5 tw-px-2",
            "focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-base-100"
          )}
          onClick={onNewChat}
        >
          <SquarePen className="tw-size-4" />
          <span className="tw-sr-only @[258px]/sidebar-header:tw-not-sr-only">New chat</span>
        </Button>
        <Button
          variant="ghost2"
          size="icon"
          aria-label="Search chats"
          aria-pressed={searchOpen}
          title="Search chats"
          className="tw-size-8 tw-shrink-0"
          onClick={toggleSearch}
        >
          <Search className="tw-size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              aria-label="Sidebar options"
              title="Sidebar options"
              className="tw-size-8 tw-shrink-0"
            >
              <MoreHorizontal className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onViewArchived}>
              <Archive />
              View archived
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {searchOpen && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search chats..."
          inputClassName="!tw-h-7"
        />
      )}
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-1 tw-overflow-y-auto">
        {matches ? (
          matches.length === 0 ? (
            <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No matching chats</div>
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {matches.map((item) => renderChat(item, true))}
            </div>
          )
        ) : items.length === 0 && projects.length === 0 ? (
          <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No chats yet</div>
        ) : (
          <>
            {groups.pinned.length > 0 && (
              <Group
                title="Pinned"
                collapsed={collapsedGroups.has("pinned")}
                onToggle={() => onToggleGroup("pinned")}
              >
                {groups.pinned.map((item) => renderChat(item, true))}
              </Group>
            )}
            {visibleProjects.length > 0 && (
              <Group
                title="Projects"
                collapsed={collapsedGroups.has("projects")}
                onToggle={() => onToggleGroup("projects")}
              >
                {visibleProjects.map(({ project, chats }) => {
                  const expanded = expandedProjectIds.has(project.id);
                  const fullyShown = fullyShownProjectIds.has(project.id);
                  const shownCount = !expanded
                    ? 0
                    : fullyShown
                      ? chats.length
                      : VISIBLE_CHATS_PER_PROJECT;
                  return (
                    <div key={project.id} className="tw-flex tw-flex-col tw-gap-0.5">
                      <SessionsSidebarFolderRow
                        project={project}
                        expanded={expanded}
                        hiddenStatus={mostUrgentStatus(chats.slice(shownCount).map(statusOf))}
                        onToggle={() => onToggleProject(project.id)}
                        onDeleted={onProjectDeleted}
                      />
                      {/* An empty container would still add the column gap, so an empty project says so instead.
                          https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
                      {expanded && chats.length === 0 && (
                        <div className="tw-py-1 tw-pl-8 tw-text-xs tw-text-muted">No chats</div>
                      )}
                      {/* A project's chats indent by the folder icon and its gap, so their titles start under the project name.
                          https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
                      {expanded && chats.length > 0 && (
                        <div className="tw-ml-6 tw-flex tw-flex-col tw-gap-0.5">
                          {chats.slice(0, shownCount).map((item) => renderChat(item))}
                          {shownCount < chats.length && (
                            <ShowMoreButton
                              onClick={() =>
                                setFullyShownProjectIds((ids) => new Set(ids).add(project.id))
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {visibleProjects.length < groups.projects.length && (
                  <ShowMoreButton onClick={() => setAllProjectsShown(true)} />
                )}
              </Group>
            )}
            {groups.recents.length > 0 && (
              <Group
                title="Recents"
                collapsed={collapsedGroups.has("recents")}
                onToggle={() => onToggleGroup("recents")}
              >
                {groups.recents.slice(0, displayCount).map((item) => renderChat(item))}
                {displayCount < groups.recents.length && (
                  <div ref={sentinelRef} className="tw-h-1" aria-hidden="true" />
                )}
              </Group>
            )}
          </>
        )}
      </div>
    </div>
  );
};
