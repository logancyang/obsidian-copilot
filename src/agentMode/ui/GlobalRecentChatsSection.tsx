import { backendRegistry } from "@/agentMode/backends/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { sortByStrategy } from "@/utils/recentUsageManager";
import { ArrowUpRight, Check, Edit2, MessageCircle, Trash2, X } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

interface GlobalRecentChatsSectionProps {
  /** Recent chats supplied by core (global getChatHistoryItems). */
  items: ChatHistoryItem[];
  /** Open a chat by id (markdown path or native session id). */
  onLoadChat: (id: string) => Promise<void>;
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  /**
   * Open the chat's source note. Only meaningful for markdown-saved chats;
   * native (autosave-off) entries have no file, so the row hides the action.
   */
  onOpenSourceFile: (id: string) => Promise<void>;
  /** Refresh the items (called once when the section mounts). */
  onLoadHistory?: () => void;
  className?: string;
}

/**
 * Brand icon for the backend a chat ran on. Returns `undefined` for legacy
 * chats without a `backendId`, in which case the row falls back to a generic
 * message glyph.
 */
function resolveChatIcon(
  item: ChatHistoryItem
): React.ComponentType<{ className?: string }> | undefined {
  return item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;
}

// Most-recent-first, matching the rest of the landing (last-used desc, falling
// back to created; ties broken by name then created). Upstream
// `getChatHistoryItems()` returns vault-scan order, so the sort lives here.
function sortChatsByRecent(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return sortByStrategy(items, "recent", {
    getName: (item) => item.title,
    getCreatedAtMs: (item) => item.createdAt.getTime(),
    getLastUsedAtMs: (item) => item.lastAccessedAt.getTime(),
  });
}

/**
 * Neutral tile holding the chat's backend brand glyph (or the generic
 * fallback), sized to match the project tiles so the two shelf tabs share one
 * leading-slot width.
 */
const ChatIconTile = memo(({ Icon }: { Icon: React.ComponentType<{ className?: string }> }) => (
  <span
    aria-hidden="true"
    className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted"
  >
    <Icon className="tw-size-4" />
  </span>
));
ChatIconTile.displayName = "ChatIconTile";

interface RecentChatRowProps {
  item: ChatHistoryItem;
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
  /** Whether this chat has a source note to open (markdown-saved only). */
  canOpenSourceFile: boolean;
  onOpenSourceFile: (id: string) => void;
}

/**
 * One chat row: click to open, hover to reveal go-to-file (markdown only),
 * rename (inline edit), and delete (two-step confirm). Mirrors the chat
 * history popover's row affordances so the landing surface manages chats
 * directly instead of deferring everything to a separate popover.
 */
const RecentChatRow = memo(function RecentChatRow({
  item,
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
}: RecentChatRowProps): React.ReactElement {
  const Icon = resolveChatIcon(item) ?? MessageCircle;

  if (isEditing) {
    return (
      <div className="tw-flex tw-min-h-9 tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5">
        <ChatIconTile Icon={Icon} />
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

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-group tw-flex tw-min-h-9 tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
        "tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
      )}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        // Only the row itself opens on Enter/Space. Without this, a keydown on
        // a focused action button (rename/delete/open-source) bubbles up here
        // and would also open the chat — the buttons stop click propagation,
        // not keydown.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      <ChatIconTile Icon={Icon} />
      <span
        className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal"
        title={item.title}
      >
        {item.title}
      </span>

      {/* Relative time by default; the action cluster replaces it on hover or
          keyboard focus so a narrow sidebar doesn't have to fit both. The
          `group-focus-within` path keeps the actions reachable for keyboard
          users (focusing the row reveals them, so Tab can move into them) —
          on hover alone they'd stay `display:none` and out of the tab order. */}
      <span
        className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted group-focus-within:tw-hidden group-hover:tw-hidden"
        title={new Date(item.lastAccessedAt).toLocaleString()}
      >
        {formatCompactRelativeTime(item.lastAccessedAt.getTime())}
      </span>
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
  );
});

/**
 * "Recent Chats" section for the Agent Home landing. A searchable, scrollable
 * list whose rows manage chats in place — open, rename, delete, and (for
 * markdown-saved chats only) open the source note — the same affordances as the
 * chat history popover, without a separate "view all" step. Native
 * (autosave-off) sessions appear here too; they just have no source note.
 */
export const GlobalRecentChatsSection = memo(function GlobalRecentChatsSection({
  items,
  onLoadChat,
  onUpdateTitle,
  onDeleteChat,
  onOpenSourceFile,
  onLoadHistory,
  className,
}: GlobalRecentChatsSectionProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Refresh once when the section first mounts (i.e. the user opened the
  // Recent Chats tab), mirroring the old popover's refresh-on-open.
  useEffect(() => {
    onLoadHistory?.();
  }, [onLoadHistory]);

  const sortedItems = useMemo(() => sortChatsByRecent(items), [items]);
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedItems;
    return sortedItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [sortedItems, query]);

  const handleStartEdit = useCallback((id: string, title: string) => {
    setConfirmDeleteId(null);
    setEditingId(id);
    setEditingTitle(title);
  }, []);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editingTitle.trim();
    const id = editingId;
    setEditingId(null);
    if (!id || !trimmed) return;
    void onUpdateTitle(id, trimmed);
  }, [editingId, editingTitle, onUpdateTitle]);

  const handleConfirmDelete = useCallback(
    (id: string) => {
      setConfirmDeleteId(null);
      void onDeleteChat(id);
    },
    [onDeleteChat]
  );

  const handleOpenSourceFile = useCallback(
    (id: string) => {
      void onOpenSourceFile(id);
    },
    [onOpenSourceFile]
  );

  return (
    <div className={cn("tw-flex tw-flex-col tw-gap-2", className)}>
      {items.length > 0 && (
        <div className="tw-p-1">
          <SearchBar value={query} onChange={setQuery} placeholder="Search chats..." />
        </div>
      )}
      {filteredItems.length === 0 ? (
        <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">
          {items.length === 0 ? "No recent chats" : "No matching chats"}
        </div>
      ) : (
        <ScrollArea className="tw-max-h-80 tw-overflow-y-auto">
          <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
            {filteredItems.map((item) => (
              <RecentChatRow
                key={item.id}
                item={item}
                isEditing={editingId === item.id}
                editingTitle={editingTitle}
                confirmingDelete={confirmDeleteId === item.id}
                onOpen={onLoadChat}
                onStartEdit={handleStartEdit}
                onEditingTitleChange={setEditingTitle}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={() => setEditingId(null)}
                onStartDelete={setConfirmDeleteId}
                onConfirmDelete={handleConfirmDelete}
                onCancelDelete={() => setConfirmDeleteId(null)}
                canOpenSourceFile={!isNativeChatId(item.id)}
                onOpenSourceFile={handleOpenSourceFile}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});

GlobalRecentChatsSection.displayName = "GlobalRecentChatsSection";
