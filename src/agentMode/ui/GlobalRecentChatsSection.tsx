import { backendRegistry } from "@/agentMode/backends/registry";
import { AgentHomePreviewList } from "@/agentMode/ui/AgentHomeSection";
import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { RenameChatModal } from "@/agentMode/ui/RenameChatModal";
import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { describeChatDelete } from "@/lib/chatDeleteText";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SearchBar } from "@/components/ui/SearchBar";
import { type ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { ChatIconWithAttention } from "@/components/chat-components/ChatIconWithAttention";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import {
  ArrowUpRight,
  Link,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Power,
  Trash2,
} from "lucide-react";
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useState } from "react";
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

function resolveChatIcon(
  item: ChatHistoryItem
): React.ComponentType<{ className?: string }> | undefined {
  return item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;
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

function isPinned(item: ChatHistoryItem): boolean {
  return item.pinnedAt !== undefined;
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

interface RecentChatActions {
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onCopyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  onSetChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onOpenSourceFile: (id: string) => void;
  onCloseSession?: (id: string) => Promise<void>;
  onSetChatPinned: (id: string, pinned: boolean) => Promise<void>;
}

interface RowActionButtonProps extends React.ComponentPropsWithoutRef<typeof Button> {
  label: string;
}

const RowActionButton = forwardRef<HTMLButtonElement, RowActionButtonProps>(
  function RowActionButton({ label, onClick, ...props }, ref) {
    return (
      <Button
        ref={ref}
        size="sm"
        variant="ghost"
        className="tw-size-5 tw-p-0"
        aria-label={label}
        title={label}
        {...props}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
      />
    );
  }
);

interface RecentChatMenuProps {
  item: ChatHistoryItem;
  isNoteBacked: boolean;
  isSessionOpen: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: RecentChatActions;
}

function RecentChatMenu({
  item,
  isNoteBacked,
  isSessionOpen,
  open,
  onOpenChange,
  actions: {
    onUpdateTitle,
    onCopyChatLink,
    getChatBookmarkState,
    onSetChatBookmarked,
    onDeleteChat,
    onOpenSourceFile,
    onCloseSession,
    onSetChatPinned,
  },
}: RecentChatMenuProps): React.ReactElement {
  const app = useApp();
  const pinned = isPinned(item);
  const readBookmarkState = useCallback(
    () => getChatBookmarkState(item.id),
    [getChatBookmarkState, item.id]
  );
  const [rowBody, setRowBody] = useState<HTMLElement | null>(null);
  const trackRowBody = useCallback(
    (node: HTMLButtonElement | null) => setRowBody(node?.ownerDocument.body ?? null),
    []
  );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <RowActionButton label="More actions" ref={trackRowBody}>
          <MoreHorizontal className="tw-size-4" />
        </RowActionButton>
      </DropdownMenuTrigger>
      {/* The menu renders in the row's own window, and React events bubble out of the portal to the row, which would open the chat.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/693 */}
      <DropdownMenuContent
        align="end"
        container={rowBody}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem onSelect={() => safeAsyncHandler(onSetChatPinned)(item.id, !pinned)}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? "Unpin chat" : "Pin chat"}
        </DropdownMenuItem>
        {isNoteBacked && (
          <DropdownMenuItem onSelect={() => onOpenSourceFile(item.id)}>
            <ArrowUpRight />
            Open source note
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() =>
            new RenameChatModal(app, item.title, (title) => onUpdateTitle(item.id, title)).open()
          }
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => safeAsyncHandler(onCopyChatLink)(item.id)}>
          <Link />
          Copy chat link
        </DropdownMenuItem>
        <ChatBookmarkMenuItem
          getBookmarkState={readBookmarkState}
          onSetBookmarked={(bookmarked) =>
            safeAsyncHandler(onSetChatBookmarked)(item.id, item.title, bookmarked)
          }
        />
        <DropdownMenuSeparator />
        {isSessionOpen && onCloseSession && (
          <DropdownMenuItem onSelect={() => safeAsyncHandler(onCloseSession)(item.id)}>
            <Power />
            Close chat
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="tw-text-error focus:tw-text-error"
          onSelect={() =>
            new ConfirmModal(
              app,
              () => onDeleteChat(item.id),
              describeChatDelete(item.backendId ? backendRegistry[item.backendId] : undefined),
              "Delete chat",
              "Delete",
              "Cancel"
            ).open()
          }
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const Icon = resolveChatIcon(item) ?? MessageCircle;
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
              label="Close chat"
              onClick={() => safeAsyncHandler(onCloseSession)(item.id)}
            >
              <Power className="tw-size-3" />
            </RowActionButton>
          )}
          {isNoteBacked && (
            <RowActionButton label="Open source note" onClick={() => onOpenSourceFile(item.id)}>
              <ArrowUpRight className="tw-size-4" />
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
    }),
    [
      getChatBookmarkState,
      handleOpenSourceFile,
      onCloseSession,
      onCopyChatLink,
      onDeleteChat,
      onSetChatBookmarked,
      onSetChatPinned,
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
    </div>
  );
});

GlobalRecentChatsSection.displayName = "GlobalRecentChatsSection";
