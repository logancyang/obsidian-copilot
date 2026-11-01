import { CreateProjectPanel } from "@/agentMode/ui/CreateProjectPanel";
import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
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
import { Archive, ChevronRight, MoreHorizontal, Plus, Search, SquarePen } from "lucide-react";
import React, { useCallback, useId, useMemo, useState } from "react";

interface SessionsSidebarPanelProps {
  items: readonly ChatHistoryItem[];
  projects: readonly ProjectConfig[];
  expandedProjectIds: ReadonlySet<string>;
  activeProjectId: string;
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
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => Promise<void>;
  onProjectDeleted: (projectId: string) => void;
  onViewArchived: () => void;
}

interface GroupProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  actionPinned?: boolean;
  children: React.ReactNode;
}

const Group: React.FC<GroupProps> = ({
  title,
  collapsed,
  onToggle,
  action,
  actionPinned,
  children,
}) => {
  const headerId = useId();
  return (
    // Obsidian shows an aria-label as a hover tooltip, so the section takes its name from the header instead.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/802
    <section aria-labelledby={headerId} className="tw-flex tw-flex-col tw-gap-0.5">
      <div className="tw-group tw-relative">
        {/* The header text starts in the chat title column, so first-level rows sit flush under it and their status
            indicators hang in the margin to the left. https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <h3 className="tw-m-0">
          <button
            id={headerId}
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className={cn(
              "clickable-icon tw-flex tw-h-auto tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-bg-transparent",
              "tw-pb-1 tw-pl-8 tw-pr-2 tw-pt-2 tw-text-left tw-text-xs tw-font-medium tw-text-muted tw-shadow-none"
            )}
          >
            <span className="tw-min-w-0 tw-flex-1 tw-truncate">{title}</span>
            {action && <span aria-hidden="true" className="tw-w-5 tw-shrink-0" />}
            <ChevronRight className={cn("tw-size-4 tw-shrink-0", !collapsed && "tw-rotate-90")} />
          </button>
        </h3>
        {/* The header action fills a slot the header always reserves left of the chevron, so showing it on hover
            never moves the title or the chevron.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        {action && (
          <div
            className={cn(
              "tw-absolute tw-bottom-0.5 tw-right-8 tw-flex tw-items-center",
              actionPinned
                ? "tw-visible"
                : "tw-invisible group-focus-within:tw-visible group-hover:tw-visible"
            )}
          >
            {action}
          </div>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
};

const ShowMoreButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    type="button"
    variant="ghost2"
    size="sm"
    className="tw-h-7 tw-justify-start tw-pl-8 tw-pr-2 tw-text-muted"
    onClick={onClick}
  >
    Show more
  </Button>
);

export const SessionsSidebarPanel: React.FC<SessionsSidebarPanelProps> = ({
  items,
  projects,
  expandedProjectIds,
  activeProjectId,
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
  onOpenProject,
  onCreateProject,
  onProjectDeleted,
  onViewArchived,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allProjectsShown, setAllProjectsShown] = useState(false);
  const [fullyShownProjectIds, setFullyShownProjectIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);

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

  const closeCreateProject = useCallback(() => setCreateAnchor(null), []);
  const saveNewProject = useCallback(
    async ({ name }: { name: string }) => {
      await onCreateProject(name);
      setCreateAnchor(null);
    },
    [onCreateProject]
  );

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
      <div className="tw-flex tw-items-center tw-gap-1">
        <h2 className="tw-m-0 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2 tw-px-2 tw-text-ui-medium tw-font-semibold tw-text-normal">
          <CopilotBrandIcon className="tw-size-5" />
          Copilot
        </h2>
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
      <Button
        variant="ghost2"
        onClick={onNewChat}
        className="tw-h-8 tw-w-full tw-justify-start tw-gap-2 tw-px-2 tw-text-normal"
      >
        <SquarePen className="tw-size-4" />
        New chat
      </Button>
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
        ) : (
          <>
            {items.length === 0 && projects.length === 0 && (
              <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No chats yet</div>
            )}
            {groups.pinned.length > 0 && (
              <Group
                title="Pinned"
                collapsed={collapsedGroups.has("pinned")}
                onToggle={() => onToggleGroup("pinned")}
              >
                {groups.pinned.map((item) => renderChat(item, true))}
              </Group>
            )}
            <Group
              title="Projects"
              collapsed={collapsedGroups.has("projects")}
              onToggle={() => onToggleGroup("projects")}
              actionPinned={createAnchor !== null}
              action={
                <RowActionButton
                  label="New project"
                  onClick={(event) => setCreateAnchor(event.currentTarget)}
                >
                  <Plus className="tw-size-4" />
                </RowActionButton>
              }
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
                      active={
                        activeProjectId === project.id &&
                        !chats.slice(0, shownCount).some((item) => activeChatIds.has(item.id))
                      }
                      hiddenStatus={mostUrgentStatus(chats.slice(shownCount).map(statusOf))}
                      onToggle={() => onToggleProject(project.id)}
                      onNewChat={() => onOpenProject(project.id)}
                      onDeleted={onProjectDeleted}
                    />
                    {/* An empty container would still add the column gap, so an empty project says so instead.
                        https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
                    {expanded && chats.length === 0 && (
                      <div className="tw-py-1 tw-pl-14 tw-text-xs tw-text-muted">No chats</div>
                    )}
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
      {createAnchor && (
        <CreateProjectPanel
          anchorEl={createAnchor}
          onClose={closeCreateProject}
          onSave={saveNewProject}
        />
      )}
    </div>
  );
};
