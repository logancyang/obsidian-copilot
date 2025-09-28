import React, { useMemo, useState } from "react";
import { ArrowUpRight, Check, Edit2, MessageCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/SearchBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Platform } from "obsidian";

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: Date;
}

interface ChatHistoryPopoverProps {
  children: React.ReactNode;
  chatHistory: ChatHistoryItem[];
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLoadChat?: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
}

export function ChatHistoryPopover({
  children,
  chatHistory,
  onUpdateTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
}: ChatHistoryPopoverProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const isMobile = Platform.isMobile;

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return chatHistory;
    return chatHistory.filter((chat) =>
      chat.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [chatHistory, searchQuery]);

  const groupedHistory = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      chats: ChatHistoryItem[];
      priority: number;
    }> = [];
    const groupMap = new Map<string, ChatHistoryItem[]>();
    const now = new Date();

    filteredHistory.forEach((chat) => {
      const diffTime = now.getTime() - chat.createdAt.getTime();
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

    // Sort by priority, ensuring Today is at the top.
    return groups.sort((a, b) => a.priority - b.priority);
  }, [filteredHistory]);

  const handleStartEdit = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveEdit = async () => {
    if (editingId && editingTitle.trim()) {
      try {
        await onUpdateTitle(editingId, editingTitle.trim());
        // Clear editing state only after successful update
        setEditingId(null);
        setEditingTitle("");
      } catch (error) {
        logError("Error updating title:", error);
        // Keep editing state active if update failed
        return;
      }
    } else {
      // Clear editing state if no valid title
      setEditingId(null);
      setEditingTitle("");
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId === id) {
      // Confirmed deletion - execute the actual delete
      try {
        await onDeleteChat(id);
        setConfirmDeleteId(null);
      } catch (error) {
        logError("Error deleting chat:", error);
        // Clear confirmation state even if deletion failed
        setConfirmDeleteId(null);
      }
    } else {
      // First click - show confirmation
      setConfirmDeleteId(id);
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => {
        setConfirmDeleteId(null);
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
    setOpen(false); // Close popover after loading chat
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="tw-w-80 tw-p-0" align="end" side="top">
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
                groupedHistory.map((group) => (
                  <div
                    key={group.key}
                    className="tw-mb-3 tw-border-x-[0px] tw-border-b tw-border-t-[0px] tw-border-border tw-pb-2"
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
                          isEditing={editingId === chat.id}
                          editingTitle={editingTitle}
                          onEditingTitleChange={setEditingTitle}
                          onStartEdit={handleStartEdit}
                          onSaveEdit={handleSaveEdit}
                          onCancelEdit={handleCancelEdit}
                          onDelete={handleDelete}
                          onCancelDelete={handleCancelDelete}
                          onLoadChat={handleLoadChat}
                          onOpenSourceFile={onOpenSourceFile}
                          isMobile={isMobile}
                          confirmDeleteId={confirmDeleteId}
                        />
                      ))}
                    </div>
                  </div>
                ))
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
}

function ChatHistoryItem({
  chat,
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
}: ChatHistoryItemProps) {
  if (isEditing) {
    return (
      <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2">
        <MessageCircle className="tw-size-3 tw-shrink-0 tw-text-muted" />
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
        "tw-group tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-dropdown-hover"
      )}
      onClick={() => onLoadChat(chat.id)}
    >
      <MessageCircle className="tw-size-3 tw-shrink-0 tw-text-muted" />

      <div className="tw-min-w-0 tw-flex-1">
        <span className="tw-block tw-truncate tw-text-sm tw-font-medium tw-text-normal">
          {chat.title}
        </span>
      </div>

      <div
        className={cn(
          "tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-transition-opacity",
          isMobile ? "tw-flex" : "tw-hidden group-hover:tw-flex"
        )}
      >
        {confirmDeleteId === chat.id ? (
          // Show confirmation buttons only
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
          // Show edit and delete buttons
          <>
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
