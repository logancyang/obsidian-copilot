import { backendRegistry } from "@/agentMode/backends/registry";
import { describeChatDelete } from "@/lib/chatDeleteText";
import { AgentHomePreviewList } from "@/agentMode/ui/AgentHomeSection";
import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/SearchBar";
import { type ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { ChatIconWithAttention } from "@/components/chat-components/ChatIconWithAttention";
import { logError } from "@/logger";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { sortByStrategy, type SortStrategy } from "@/utils/recentUsageManager";
import {
  ArrowUpRight,
  Check,
  Edit2,
  LoaderCircle,
  MessageCircle,
  Power,
  Trash2,
  X,
} from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useIncrementalPaging } from "@/hooks/useIncrementalPaging";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const NOOP_SAVE = (): void => {};

export type RecentChatsVariant = "global" | "project";

interface GlobalRecentChatsSectionProps {
  items: ChatHistoryItem[];
  variant?: RecentChatsVariant;
  title?: string;
  onLoadChat: (id: string) => Promise<void>;
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onOpenSourceFile: (id: string) => Promise<void>;
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
  isEditing: boolean;
  editingTitle: string;
  confirmingDelete: boolean;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onEditingTitleChange: (title: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  canOpenSourceFile: boolean;
  onOpenSourceFile: (id: string) => void;
  isRunning: boolean;
  isSessionOpen: boolean;
  onCloseSession?: (id: string) => Promise<void>;
  hasAttention: boolean;
}

const RecentChatRow = memo(function RecentChatRow({
  item,
  projectName,
  isEditing,
  editingTitle,
  confirmingDelete,
  onOpen,
  onStartEdit,
  onEditingTitleChange,
  onSaveEdit,
  onCancelEdit,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  canOpenSourceFile,
  onOpenSourceFile,
  isRunning,
  isSessionOpen,
  onCloseSession,
  hasAttention,
}: RecentChatRowProps): React.ReactElement {
  const Icon = resolveChatIcon(item) ?? MessageCircle;

  if (isEditing) {
    return (
      <div className="tw-flex tw-min-h-9 tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5">
        <ChatIconTile Icon={Icon} needsAttention={hasAttention} />
        <Input
          value={editingTitle}
          onChange={(e) => onEditingTitleChange(e.target.value)}
          className="!tw-h-6 tw-flex-1"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveEdit();
            else if (e.key === "Escape") onCancelEdit();
          }}
        />
        <Button size="sm" variant="ghost" onClick={onSaveEdit} className="tw-size-5 tw-p-0">
          <Check className="tw-size-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelEdit} className="tw-size-5 tw-p-0">
          <X className="tw-size-3" />
        </Button>
      </div>
    );
  }

  const deleteSummary = confirmingDelete
    ? describeChatDelete(item.backendId ? backendRegistry[item.backendId] : undefined)
    : undefined;

  return (
    <div className="tw-group">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "tw-flex tw-min-h-9 tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
          "tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
        )}
        onClick={() => onOpen(item.id)}
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
                "group-focus-within:tw-hidden group-hover:tw-hidden"
              )}
              aria-label="Responding"
            />
          ) : (
            <span
              className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted group-focus-within:tw-hidden group-hover:tw-hidden"
              title={new Date(item.lastAccessedAt).toLocaleString()}
            >
              {formatCompactRelativeTime(item.lastAccessedAt.getTime())}
            </span>
          )}
          <div className="tw-hidden tw-shrink-0 tw-items-center tw-gap-1.5 group-focus-within:tw-flex group-hover:tw-flex">
            {confirmingDelete ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmDelete(item.id);
                  }}
                  className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
                  title="Confirm delete"
                >
                  <Check className="tw-size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelDelete();
                  }}
                  className="tw-size-5 tw-p-0"
                  title="Cancel"
                >
                  <X className="tw-size-3" />
                </Button>
              </>
            ) : (
              <>
                {isSessionOpen && onCloseSession && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tw-size-5 tw-p-0"
                    aria-label="Close session"
                    title="Close session"
                    onClick={(event) => {
                      event.stopPropagation();
                      safeAsyncHandler(onCloseSession)(item.id);
                    }}
                  >
                    <Power className="tw-size-3" />
                  </Button>
                )}
                {canOpenSourceFile && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSourceFile(item.id);
                    }}
                    className="tw-size-5 tw-p-0"
                    title="Open source note"
                  >
                    <ArrowUpRight className="tw-size-4" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit(item.id, item.title);
                  }}
                  className="tw-size-5 tw-p-0"
                  title="Rename"
                >
                  <Edit2 className="tw-size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartDelete(item.id);
                  }}
                  className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
                  title="Delete"
                >
                  <Trash2 className="tw-size-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {deleteSummary && (
        <div className="tw-px-2 tw-pb-1.5 tw-text-xs tw-text-muted">{deleteSummary}</div>
      )}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    onLoadHistory?.();
  }, [onLoadHistory]);

  const sortedItems = useMemo(() => sortChats(items, sortStrategy), [items, sortStrategy]);
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

  const handleStartEdit = useCallback((id: string, title: string) => {
    setConfirmDeleteId(null);
    setEditingId(id);
    setEditingTitle(title);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    const trimmed = editingTitle.trim();
    const id = editingId;
    if (!id || !trimmed) {
      setEditingId(null);
      return;
    }

    try {
      await onUpdateTitle(id, trimmed);
      setEditingId(null);
    } catch (error) {
      logError("Error updating title:", error);
    }
  }, [editingId, editingTitle, onUpdateTitle]);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await onDeleteChat(id);
        setConfirmDeleteId(null);
      } catch (error) {
        logError("Error deleting chat:", error);
      }
    },
    [onDeleteChat]
  );

  const handleSaveEditSafely = safeAsyncHandler(handleSaveEdit);
  const handleConfirmDeleteSafely = safeAsyncHandler(handleConfirmDelete);

  const handleOpenSourceFile = useCallback(
    (id: string) => {
      void onOpenSourceFile(id);
    },
    [onOpenSourceFile]
  );

  const handleOpen = safeAsyncHandler(onLoadChat);

  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleCancelDelete = useCallback(() => setConfirmDeleteId(null), []);
  const getProjectName = useCallback(
    (item: ChatHistoryItem): string | undefined =>
      variant === "global" && item.projectId ? projectNamesById?.[item.projectId] : undefined,
    [projectNamesById, variant]
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
          <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
            {visibleItems.map((item) => (
              <RecentChatRow
                key={item.id}
                item={item}
                projectName={getProjectName(item)}
                isEditing={editingId === item.id}
                editingTitle={editingId === item.id ? editingTitle : ""}
                confirmingDelete={confirmDeleteId === item.id}
                onOpen={handleOpen}
                onStartEdit={handleStartEdit}
                onEditingTitleChange={setEditingTitle}
                onSaveEdit={editingId === item.id ? handleSaveEditSafely : NOOP_SAVE}
                onCancelEdit={handleCancelEdit}
                onStartDelete={setConfirmDeleteId}
                onConfirmDelete={handleConfirmDeleteSafely}
                onCancelDelete={handleCancelDelete}
                canOpenSourceFile={!isNativeChatId(item.id)}
                onOpenSourceFile={handleOpenSourceFile}
                isRunning={runningChatIds?.has(item.id) ?? false}
                isSessionOpen={openChatIds?.has(item.id) ?? false}
                onCloseSession={onCloseSession}
                hasAttention={!!item.needsAttention || (attentionChatIds?.has(item.id) ?? false)}
              />
            ))}
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
