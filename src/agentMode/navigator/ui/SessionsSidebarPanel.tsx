import { CreateProjectPanel } from "@/agentMode/ui/CreateProjectPanel";
import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { SessionsSidebarFolderRow } from "@/agentMode/navigator/ui/SessionsSidebarFolderRow";
import {
  SessionsSidebarRow,
  mostUrgentStatus,
  resolveSessionStatus,
  type SortHandle,
} from "@/agentMode/navigator/ui/SessionsSidebarRow";
import {
  RECENTS_PAGE_SIZE,
  VISIBLE_CHATS_PER_PROJECT,
  VISIBLE_PROJECTS,
  filterChatsByTitle,
  groupSessionsSidebarChats,
  pinnedAtAfterMove,
} from "@/agentMode/navigator/ui/sessionsSidebarGroups";
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
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, ChevronRight, MoreHorizontal, Plus, Search, SquarePen } from "lucide-react";
import React, { useCallback, useId, useMemo, useState } from "react";

interface SessionsSidebarPanelProps {
  items: readonly ChatHistoryItem[];
  projects: readonly ProjectConfig[];
  expandedProjectIds: ReadonlySet<string>;
  projectOrder: ReadonlySet<string>;
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
  onReorderProjects: (projectIds: string[]) => void;
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
        <h3 className="tw-m-0">
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
            {action && <span aria-hidden="true" className="tw-w-5 tw-shrink-0" />}
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

// Space picks a row up so Enter keeps opening the chat or folding the project, and the pointer has to travel before a
// drag starts so a click still opens or folds.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/811
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

interface SortableListProps {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: React.ReactNode;
}

const SortableList: React.FC<SortableListProps> = ({ ids, onMove, children }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    })
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) {
          onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
        }
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
};

interface SortableItemProps {
  id: string;
  children: (handle: SortHandle) => React.ReactNode;
}

const SortableItem: React.FC<SortableItemProps> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
      className={cn(
        "tw-flex tw-flex-col tw-gap-0.5 tw-rounded-md",
        isDragging && "tw-relative tw-z-[1] tw-bg-primary tw-ring-1 tw-ring-inset tw-ring-ring"
      )}
    >
      {children({ ref: setActivatorNodeRef, attributes, listeners })}
    </div>
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
  projectOrder,
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
  onReorderProjects,
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

  const groups = useMemo(
    () => groupSessionsSidebarChats(items, projects, projectOrder),
    [items, projects, projectOrder]
  );
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
  const { displayCount: matchDisplayCount, sentinelRef: matchSentinelRef } = useIncrementalPaging(
    matches?.length ?? 0,
    query,
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

  const renderChat = (item: ChatHistoryItem, labelProject = false, sortHandle?: SortHandle) => (
    <SessionsSidebarRow
      key={item.id}
      sortHandle={sortHandle}
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
  const pinnedIds = groups.pinned.map((item) => item.id);
  const projectIds = groups.projects.map(({ project }) => project.id);

  return (
    <div className="tw-flex tw-size-full tw-min-h-0 tw-flex-col tw-gap-2 tw-p-2">
      <div className="tw-flex tw-items-center tw-gap-1 tw-@container/sidebar-header">
        <h2 className="tw-m-0 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1 tw-pl-2 tw-text-ui-medium tw-font-semibold tw-text-normal">
          <CopilotBrandIcon className="tw-size-5 tw-shrink-0" />
          <span className="tw-truncate">Copilot</span>
        </h2>
        {/* New chat keeps its label only while at least 16px stays between it and the Copilot title, and drops to its icon
            otherwise; the label stays as its screen-reader name, since an aria-label would show as a tooltip.
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
          <span className="tw-sr-only @[272px]/sidebar-header:tw-not-sr-only">New chat</span>
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
          autoFocus
          inputClassName="!tw-h-7"
        />
      )}
      {/* The list reaches into the panel's right padding so its scrollbar sits at the pane edge, as in Relevant Notes.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
      <div className="-tw-mr-2 tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-pr-2">
        {matches ? (
          matches.length === 0 ? (
            <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No matching chats</div>
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {matches.slice(0, matchDisplayCount).map((item) => renderChat(item, true))}
              {matchDisplayCount < matches.length && (
                <div ref={matchSentinelRef} className="tw-h-1" aria-hidden="true" />
              )}
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
                <SortableList
                  ids={pinnedIds}
                  onMove={(from, to) =>
                    void actions.onSetChatPinned(
                      pinnedIds[from],
                      true,
                      pinnedAtAfterMove(groups.pinned, from, to)
                    )
                  }
                >
                  {groups.pinned.map((item) => (
                    <SortableItem key={item.id} id={item.id}>
                      {(handle) => renderChat(item, true, handle)}
                    </SortableItem>
                  ))}
                </SortableList>
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
              <SortableList
                ids={visibleProjects.map(({ project }) => project.id)}
                onMove={(from, to) => onReorderProjects(arrayMove(projectIds, from, to))}
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
                    <SortableItem key={project.id} id={project.id}>
                      {(handle) => (
                        <>
                          <SessionsSidebarFolderRow
                            sortHandle={handle}
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
                        </>
                      )}
                    </SortableItem>
                  );
                })}
              </SortableList>
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
