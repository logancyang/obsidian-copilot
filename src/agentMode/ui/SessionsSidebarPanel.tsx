import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { SessionsSidebarFolderRow } from "@/agentMode/ui/SessionsSidebarFolderRow";
import { SessionsSidebarNewProjectRow } from "@/agentMode/ui/SessionsSidebarNewProjectRow";
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
import { err2String } from "@/utils";
import { Archive, MoreHorizontal, Plus, Search, SquarePen } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

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
  actions: RecentChatActions;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onToggleProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => Promise<void>;
  onProjectDeleted: (projectId: string) => void;
  onViewArchived: () => void;
}

const Group: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section aria-label={title} className="tw-flex tw-flex-col tw-gap-0.5">
    <div className="tw-flex tw-items-center tw-justify-between tw-pr-1">
      <h3 className="tw-m-0 tw-px-2 tw-pb-0.5 tw-pt-2 tw-text-xs tw-font-medium tw-text-muted">
        {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
);

interface NewProjectDraft {
  name: string;
  saving: boolean;
  error?: string;
}

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
  activeProjectId,
  activeChatIds,
  runningChatIds,
  waitingChatIds,
  attentionChatIds,
  openChatIds,
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

  const [newProject, setNewProject] = useState<NewProjectDraft | null>(null);

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

  const submitNewProject = useCallback(async () => {
    if (!newProject) return;
    const name = newProject.name.trim();
    if (!name) {
      setNewProject(null);
      return;
    }
    setNewProject({ name: newProject.name, saving: true });
    try {
      await onCreateProject(name);
      setNewProject(null);
    } catch (error) {
      setNewProject({ name: newProject.name, saving: false, error: err2String(error) });
    }
  }, [newProject, onCreateProject]);

  const statusOf = (item: ChatHistoryItem) =>
    resolveSessionStatus({
      waiting: waitingChatIds.has(item.id),
      unread: !!item.needsAttention || attentionChatIds.has(item.id),
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
              <Group title="Pinned">{groups.pinned.map((item) => renderChat(item, true))}</Group>
            )}
            <Group
              title="Projects"
              action={
                <RowActionButton
                  label="New project"
                  onClick={() => setNewProject((draft) => draft ?? { name: "", saving: false })}
                >
                  <Plus className="tw-size-4" />
                </RowActionButton>
              }
            >
              {newProject && (
                <SessionsSidebarNewProjectRow
                  {...newProject}
                  onNameChange={(name) => setNewProject({ name, saving: false })}
                  onSubmit={() => void submitNewProject()}
                  onCancel={() => setNewProject(null)}
                />
              )}
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
                      onOpen={() => {
                        if (!expanded) onToggleProject(project.id);
                        onOpenProject(project.id);
                      }}
                      onNewChat={() => onOpenProject(project.id)}
                      onDeleted={onProjectDeleted}
                    />
                    {expanded && (
                      <div className="tw-ml-4 tw-flex tw-flex-col tw-gap-0.5">
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
              <Group title="Recents">
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
