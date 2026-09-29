import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/SearchBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChatIconWithAttention } from "@/components/chat-components/ChatIconWithAttention";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { sortByStrategy } from "@/utils/recentUsageManager";
import { Platform } from "obsidian";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const PAGE_SIZE = 50;

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: Date;
  lastAccessedAt: Date;
  backendId?: string;
  projectId?: string;
  needsAttention?: boolean;
}

type ChatHistoryIconResolver = (
  item: ChatHistoryItem
) => React.ComponentType<{ className?: string }> | undefined;

type ChatHistoryBadgeResolver = (item: ChatHistoryItem) => React.ReactNode;

interface ChatHistoryPopoverProps {
  children: React.ReactNode;
  chatHistory: ChatHistoryItem[];
  openChatIds?: ReadonlySet<string>;
  runningChatIds?: ReadonlySet<string>;
  onCloseSession?: (id: string) => Promise<void>;
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLoadChat?: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  getIcon?: ChatHistoryIconResolver;
  getBadge?: ChatHistoryBadgeResolver;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function ChatHistoryPopover({
  children,
  chatHistory,
  openChatIds,
  runningChatIds,
  onCloseSession,
  onUpdateTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
  getIcon,
  getBadge,
  side = "top",
  align = "end",
}: ChatHistoryPopoverProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const deleteTimeoutRef = useRef<number | null>(null);
  const isMobile = Platform.isMobile;
  const settings = useSettingsValue();

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return chatHistory;
    return chatHistory.filter((chat) =>
      chat.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [chatHistory, searchQuery]);

  const sortedHistory = useMemo(() => {
    return sortByStrategy(filteredHistory, settings.chatHistorySortStrategy, {
      getName: (chat) => chat.title,
      getCreatedAtMs: (chat) => chat.createdAt.getTime(),
      getLastUsedAtMs: (chat) => chat.lastAccessedAt.getTime(),
    });
  }, [filteredHistory, settings.chatHistorySortStrategy]);

  useLayoutEffect(() => {
    if (open) setDisplayCount(PAGE_SIZE);
  }, [open, searchQuery]);

  const paginatedHistory = useMemo(
    () => sortedHistory.slice(0, displayCount),
    [sortedHistory, displayCount]
  );

  const paginationStateRef = useRef({ displayCount: PAGE_SIZE, totalCount: 0 });
  useEffect(() => {
    paginationStateRef.current = { displayCount, totalCount: sortedHistory.length };
  }, [displayCount, sortedHistory.length]);

  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          const { displayCount: current, totalCount } = paginationStateRef.current;
          if (current < totalCount) {
            setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, totalCount));
          }
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const groupedHistory = useMemo(() => {
    const sortStrategy = settings.chatHistorySortStrategy;

    if (sortStrategy === "name") {
      return [
        {
          key: "All",
          label: "All",
          chats: paginatedHistory,
          priority: 0,
        },
      ];
    }

    const groups: Array<{
      key: string;
      label: string;
      chats: ChatHistoryItem[];
      priority: number;
    }> = [];
    const groupMap = new Map<string, ChatHistoryItem[]>();
    const now = new Date();

    paginatedHistory.forEach((chat) => {
      const referenceDate = sortStrategy === "recent" ? chat.lastAccessedAt : chat.createdAt;
      const diffTime = now.getTime() - referenceDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      let groupKey: string;
      let priority: number;
      if (diffDays === 0) {
        groupKey = "Today";
        priority = 0;
      } else if (diffDays === 1) {
        groupKey = "Yesterday";
        priority = 1;
      } else if (diffDays < 7) {
        groupKey = `${diffDays}d ago`;
        priority = 2 + diffDays;
      } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        groupKey = weeks === 1 ? "1w ago" : `${weeks}w ago`;
        priority = 10 + weeks;
      } else {
        const months = Math.floor(diffDays / 30);
        groupKey = months === 1 ? "1m ago" : `${months}m ago`;
        priority = 50 + months;
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
        groups.push({
          key: groupKey,
          label: groupKey,
          chats: groupMap.get(groupKey)!,
          priority,
        });
      }
      groupMap.get(groupKey)!.push(chat);
    });

    return groups.sort((a, b) => a.priority - b.priority);
  }, [settings.chatHistorySortStrategy, paginatedHistory]);

  const handleStartEdit = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveEdit = async () => {
    if (editingId && editingTitle.trim()) {
      try {
        await onUpdateTitle(editingId, editingTitle.trim());
        setEditingId(null);
        setEditingTitle("");
      } catch (error) {
        logError("Error updating title:", error);
        return;
      }
    } else {
      setEditingId(null);
      setEditingTitle("");
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  useEffect(() => {
    return () => {
      if (deleteTimeoutRef.current) {
        window.clearTimeout(deleteTimeoutRef.current);
      }
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (confirmDeleteId === id) {
      try {
        await onDeleteChat(id);
        setConfirmDeleteId(null);
      } catch (error) {
        logError("Error deleting chat:", error);
        setConfirmDeleteId(null);
      }
    } else {
      if (deleteTimeoutRef.current) {
        window.clearTimeout(deleteTimeoutRef.current);
      }
      setConfirmDeleteId(id);
      deleteTimeoutRef.current = window.setTimeout(() => {
        setConfirmDeleteId(null);
        deleteTimeoutRef.current = null;
      }, 3000);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDeleteId(null);
  };

  const handleLoadChat = async (id: string) => {
    if (onLoadChat) {
      await onLoadChat(id);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="tw-w-80 tw-max-w-[calc(100vw-2rem)] tw-p-0"
        align={align}
        side={side}
        collisionPadding={16}
      >
        <div className="tw-flex tw-max-h-[400px] tw-flex-col">
          <div className="tw-shrink-0 tw-border-b tw-p-1">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>

          <ScrollArea className="tw-min-h-[150px] tw-flex-1 tw-overflow-y-auto">
            <div className="tw-p-2">
              {groupedHistory.length === 0 ? (
                <div className="tw-py-8 tw-text-center tw-text-muted">
                  {searchQuery ? "No matching chat history found." : "No chat history"}
                </div>
              ) : (
                <>
                  {groupedHistory.map((group) => (
                    <div
                      key={group.key}
                      className="tw-mb-3 tw-border-x-0 tw-border-b tw-border-t-0 tw-border-border tw-pb-2"
                      style={{ borderBottomStyle: "solid" }}
                    >
                      <div className="tw-mb-2 tw-px-2 tw-text-xs tw-font-medium tw-tracking-wider tw-text-muted">
                        {group.label}
                      </div>
                      <div className="tw-space-y-1">
                        {group.chats.map((chat) => (
                          <ChatHistoryItem
                            key={chat.id}
                            chat={chat}
                            isSessionOpen={openChatIds?.has(chat.id) ?? false}
                            isRunning={runningChatIds?.has(chat.id) ?? false}
                            onCloseSession={onCloseSession}
                            isEditing={editingId === chat.id}
                            editingTitle={editingTitle}
                            onEditingTitleChange={setEditingTitle}
                            onStartEdit={handleStartEdit}
                            onSaveEdit={safeAsyncHandler(handleSaveEdit)}
                            onCancelEdit={handleCancelEdit}
                            onDelete={safeAsyncHandler(handleDelete)}
                            onCancelDelete={handleCancelDelete}
                            onLoadChat={safeAsyncHandler(handleLoadChat)}
                            onOpenSourceFile={
                              onOpenSourceFile ? safeAsyncHandler(onOpenSourceFile) : undefined
                            }
                            isMobile={isMobile}
                            confirmDeleteId={confirmDeleteId}
                            getIcon={getIcon}
                            getBadge={getBadge}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  <div ref={sentinelCallbackRef} className="tw-h-1" />

                  {displayCount < sortedHistory.length ? (
                    <div className="tw-py-2 tw-text-center tw-text-xs tw-text-muted">
                      Showing {displayCount} of {sortedHistory.length} — scroll for more
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ChatHistoryItemProps {
  chat: ChatHistoryItem;
  isSessionOpen: boolean;
  isRunning: boolean;
  onCloseSession?: (id: string) => Promise<void>;
  isEditing: boolean;
  editingTitle: string;
  onEditingTitleChange: (title: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onCancelDelete: () => void;
  onLoadChat: (id: string) => void;
  onOpenSourceFile?: (id: string) => void;
  isMobile: boolean;
  confirmDeleteId: string | null;
  getIcon?: ChatHistoryIconResolver;
  getBadge?: ChatHistoryBadgeResolver;
}

function ChatHistoryItem({
  chat,
  isSessionOpen,
  isRunning,
  onCloseSession,
  isEditing,
  editingTitle,
  onEditingTitleChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onCancelDelete,
  onLoadChat,
  onOpenSourceFile,
  isMobile,
  confirmDeleteId,
  getIcon,
  getBadge,
}: ChatHistoryItemProps) {
  const RowIcon = getIcon?.(chat) ?? MessageCircle;
  if (isEditing) {
    return (
      <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2">
        <ChatIconWithAttention
          icon={RowIcon}
          needsAttention={chat.needsAttention}
          iconClassName="tw-size-3 tw-text-muted"
        />
        <Input
          value={editingTitle}
          onChange={(e) => onEditingTitleChange(e.target.value)}
          className="!tw-h-6 tw-flex-1"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSaveEdit();
            } else if (e.key === "Escape") {
              onCancelEdit();
            }
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

  return (
    <div
      className={cn(
        "tw-group tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-modifier-hover"
      )}
      role="button"
      tabIndex={0}
      // Let keyboard users reach release controls without opening the chat.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onLoadChat(chat.id);
        }
      }}
      onClick={() => onLoadChat(chat.id)}
    >
      <ChatIconWithAttention
        icon={RowIcon}
        needsAttention={chat.needsAttention}
        isSessionLive={isSessionOpen}
        iconClassName="tw-size-3 tw-text-muted"
      />
      <span
        className="tw-block tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium tw-text-normal"
        title={chat.title}
      >
        {chat.title}
      </span>

      {getBadge?.(chat)}

      {isRunning && (
        <LoaderCircle
          className="tw-size-3.5 tw-shrink-0 tw-animate-spin tw-text-accent group-focus-within:tw-hidden group-hover:tw-hidden"
          aria-label="Responding"
        />
      )}

      <div
        className={cn(
          "tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-transition-opacity",
          isMobile ? "tw-flex" : "tw-hidden group-focus-within:tw-flex group-hover:tw-flex"
        )}
      >
        {confirmDeleteId === chat.id ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(chat.id);
              }}
              className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
              title="Confirm Delete"
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
              title="Cancel deletion"
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
                  safeAsyncHandler(onCloseSession)(chat.id);
                }}
              >
                <Power className="tw-size-3" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenSourceFile) {
                  onOpenSourceFile(chat.id);
                }
              }}
              className="tw-size-5 tw-p-0"
              title="Open the source file"
            >
              <ArrowUpRight className="tw-size-4" />
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(chat.id, chat.title);
              }}
              className="tw-size-5 tw-p-0"
            >
              <Edit2 className="tw-size-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(chat.id);
              }}
              className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
              title="delete file"
            >
              <Trash2 className="tw-size-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
