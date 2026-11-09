import { chatBackendIcon } from "@/agentMode/ui/chatBackendIcon";
import { AgentHomePreviewList } from "@/agentMode/ui/AgentHomeSection";
import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import {
  isPinned,
  RecentChatMenu,
  RowActionButton,
  type RecentChatActions,
} from "@/agentMode/ui/RecentChatMenu";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SearchBar } from "@/components/ui/SearchBar";
import { type ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { ChatIconWithAttention } from "@/components/chat-components/ChatIconWithAttention";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import { Archive, FileText, LoaderCircle, Pin, PinOff, Power } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useIncrementalPaging } from "@/hooks/useIncrementalPaging";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export type RecentChatsVariant = "global" | "project";

interface GlobalRecentChatsSectionProps {
  items: ChatHistoryItem[];
  variant?: RecentChatsVariant;
  title?: string;
  onLoadChat: (id: string) => Promise<void>;
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onOpenSourceFile: (id: string) => Promise<void>;
  onCopyChatLink: (id: string) => Promise<void>;
  onSetChatPinned: (id: string, pinned: boolean) => Promise<void>;
  onSetChatArchived: (id: string, archived: boolean) => Promise<void>;
  onViewArchived?: () => void;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  onSetChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  onLoadHistory?: () => void;
  runningChatIds?: ReadonlySet<string>;
  openChatIds?: ReadonlySet<string>;
  onCloseSession?: (id: string) => Promise<void>;
  attentionChatIds?: ReadonlySet<string>;
  projectNamesById?: Readonly<Record<string, string>>;
  sortStrategy?: SortStrategy;
  className?: string;
}

// Upstream `getChatHistoryItems()` returns vault-scan order. Apply the saved
// history ordering here so removing the duplicate history surface does not
// silently discard a user's preference.
// https://github.com/logancyang/obsidian-copilot/issues/3040
function sortChats(items: ChatHistoryItem[], strategy: SortStrategy): ChatHistoryItem[] {
  return sortByStrategy(items, strategy, {
    getName: (item) => item.title,
    getCreatedAtMs: (item) => item.createdAt.getTime(),
    getLastUsedAtMs: (item) => item.lastAccessedAt.getTime(),
  });
}

// Pinned chats stay in pin order so a sort change never reshuffles them.
// https://github.com/logancyang/obsidian-copilot/issues/3195
function orderChats(items: ChatHistoryItem[], strategy: SortStrategy): ChatHistoryItem[] {
  const pinned = items.filter(isPinned).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  return [
    ...pinned,
    ...sortChats(
      items.filter((item) => !isPinned(item)),
      strategy
    ),
  ];
}

const ChatIconTile = memo(
  ({
    Icon,
    needsAttention,
    isSessionLive,
  }: {
    Icon: React.ComponentType<{ className?: string }>;
    needsAttention?: boolean;
    isSessionLive?: boolean;
  }) => (
    <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
      <ChatIconWithAttention
        icon={Icon}
        needsAttention={needsAttention}
        isSessionLive={isSessionLive}
        iconClassName="tw-size-4"
      />
    </span>
  )
);
ChatIconTile.displayName = "ChatIconTile";

interface RecentChatRowProps {
  item: ChatHistoryItem;
  projectName?: string;
  onOpen: (id: string) => void;
  actions: RecentChatActions;
  isNoteBacked: boolean;
  isRunning: boolean;
  isSessionOpen: boolean;
  hasAttention: boolean;
}

const RecentChatRow = memo(function RecentChatRow({
  item,
  projectName,
  onOpen,
  actions,
  isNoteBacked,
  isRunning,
  isSessionOpen,
  hasAttention,
}: RecentChatRowProps): React.ReactElement {
  const { onOpenSourceFile, onCloseSession, onSetChatPinned } = actions;
  const Icon = chatBackendIcon(item);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinned = isPinned(item);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-group tw-flex tw-min-h-9 tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
        "tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
      )}
      onClick={() => onOpen(item.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      {/* Session ownership and active response are independent indicators.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/429 */}
      <ChatIconTile Icon={Icon} needsAttention={hasAttention} isSessionLive={isSessionOpen} />
      <RecentChatTitle title={item.title} />

      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5">
        {projectName && <RecentChatProjectBadge name={projectName} />}
        {isRunning ? (
          <LoaderCircle
            className={cn(
              "tw-size-3.5 tw-shrink-0 tw-animate-spin tw-text-accent",
              menuOpen ? "tw-hidden" : "group-focus-within:tw-hidden group-hover:tw-hidden"
            )}
            aria-label="Responding"
          />
        ) : (
          <span
            className={cn(
              "tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted",
              menuOpen ? "tw-hidden" : "group-focus-within:tw-hidden group-hover:tw-hidden"
            )}
            title={new Date(item.lastAccessedAt).toLocaleString()}
          >
            {formatCompactRelativeTime(item.lastAccessedAt.getTime())}
          </span>
        )}
        {/* The open menu is anchored to More actions, so the strip stays shown after the pointer leaves the row.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/693 */}
        <div
          className={cn(
            "tw-shrink-0 tw-items-center tw-gap-1.5",
            menuOpen ? "tw-flex" : "tw-hidden group-focus-within:tw-flex group-hover:tw-flex"
          )}
        >
          <RowActionButton
            label={pinned ? "Unpin chat" : "Pin chat"}
            onClick={() => safeAsyncHandler(onSetChatPinned)(item.id, !pinned)}
          >
            {pinned ? <PinOff className="tw-size-3.5" /> : <Pin className="tw-size-3.5" />}
          </RowActionButton>
          {isSessionOpen && onCloseSession && (
            <RowActionButton
              label="Shut down"
              onClick={() => safeAsyncHandler(onCloseSession)(item.id)}
            >
              <Power className="tw-size-3" />
            </RowActionButton>
          )}
          {isNoteBacked && (
            <RowActionButton label="Open chat note" onClick={() => onOpenSourceFile(item.id)}>
              <FileText className="tw-size-3.5" />
            </RowActionButton>
          )}
          <RecentChatMenu
            item={item}
            isNoteBacked={isNoteBacked}
            isSessionOpen={isSessionOpen}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            actions={actions}
          />
        </div>
      </div>
    </div>
  );
});

export const GlobalRecentChatsSection = memo(function GlobalRecentChatsSection({
  items,
  variant = "global",
  title,
  onLoadChat,
  onUpdateTitle,
  onDeleteChat,
  onOpenSourceFile,
  onCopyChatLink,
  onSetChatPinned,
  onSetChatArchived,
  onViewArchived,
  getChatBookmarkState,
  onSetChatBookmarked,
  onLoadHistory,
  runningChatIds,
  openChatIds,
  onCloseSession,
  attentionChatIds,
  projectNamesById,
  sortStrategy = "recent",
  className,
}: GlobalRecentChatsSectionProps): React.ReactElement {
  const [query, setQuery] = useState("");

  useEffect(() => {
    onLoadHistory?.();
  }, [onLoadHistory]);

  const sortedItems = useMemo(() => orderChats(items, sortStrategy), [items, sortStrategy]);
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedItems;
    return sortedItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [sortedItems, query]);
  const { displayCount, sentinelRef } = useIncrementalPaging(filteredItems.length, query);
  const visibleItems = useMemo(
    () => filteredItems.slice(0, displayCount),
    [displayCount, filteredItems]
  );
  const visiblePinnedCount = useMemo(() => visibleItems.filter(isPinned).length, [visibleItems]);

  const handleOpenSourceFile = useCallback(
    (id: string) => {
      void onOpenSourceFile(id);
    },
    [onOpenSourceFile]
  );

  const handleOpen = safeAsyncHandler(onLoadChat);

  const actions = useMemo(
    () => ({
      onUpdateTitle,
      onCopyChatLink,
      getChatBookmarkState,
      onSetChatBookmarked,
      onDeleteChat,
      onOpenSourceFile: handleOpenSourceFile,
      onCloseSession,
      onSetChatPinned,
      onSetChatArchived,
    }),
    [
      getChatBookmarkState,
      handleOpenSourceFile,
      onCloseSession,
      onCopyChatLink,
      onDeleteChat,
      onSetChatBookmarked,
      onSetChatPinned,
      onSetChatArchived,
      onUpdateTitle,
    ]
  );
  const getProjectName = useCallback(
    (item: ChatHistoryItem): string | undefined =>
      variant === "global" && item.projectId ? projectNamesById?.[item.projectId] : undefined,
    [projectNamesById, variant]
  );
  const renderRow = (item: ChatHistoryItem) => (
    <RecentChatRow
      key={item.id}
      item={item}
      projectName={getProjectName(item)}
      onOpen={handleOpen}
      actions={actions}
      isNoteBacked={!isNativeChatId(item.id)}
      isRunning={runningChatIds?.has(item.id) ?? false}
      isSessionOpen={openChatIds?.has(item.id) ?? false}
      hasAttention={!!item.needsAttention || (attentionChatIds?.has(item.id) ?? false)}
    />
  );
  return (
    <div
      role={title ? "group" : undefined}
      aria-label={title}
      className={cn("tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-2", className)}
    >
      {items.length > 0 && (
        <div className="tw-p-1">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search chats..."
            inputClassName="!tw-h-7"
          />
        </div>
      )}
      {filteredItems.length === 0 ? (
        <div className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">
          {items.length > 0
            ? "No matching chats"
            : variant === "project"
              ? "No chats in this project yet"
              : "No recent chats"}
        </div>
      ) : (
        <AgentHomePreviewList>
          {visiblePinnedCount > 0 && (
            <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
              {visibleItems.slice(0, visiblePinnedCount).map(renderRow)}
            </div>
          )}
          {visiblePinnedCount > 0 && visiblePinnedCount < visibleItems.length && (
            <Separator decorative={false} className="tw-my-1.5" />
          )}
          <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
            {visibleItems.slice(visiblePinnedCount).map(renderRow)}
            {displayCount < filteredItems.length && (
              <div ref={sentinelRef} className="tw-h-1" aria-hidden="true" />
            )}
          </div>
        </AgentHomePreviewList>
      )}
      {onViewArchived && (
        <Button
          type="button"
          variant="ghost2"
          size="sm"
          className="tw-mt-1 tw-w-full tw-shrink-0 tw-text-muted"
          onClick={onViewArchived}
        >
          <Archive className="tw-size-3" aria-hidden="true" />
          View archived
        </Button>
      )}
    </div>
  );
});

GlobalRecentChatsSection.displayName = "GlobalRecentChatsSection";
