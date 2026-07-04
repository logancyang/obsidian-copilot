import { backendRegistry } from "@/agentMode/backends/registry";
import { INLINE_LIMIT } from "@/agentMode/ui/AgentHomeSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { ChatIconWithAttention } from "@/components/chat-components/ChatIconWithAttention";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { sortByStrategy } from "@/utils/recentUsageManager";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Edit2,
  LoaderCircle,
  MessageCircle,
  Trash2,
  X,
} from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

/** Stable noop for rows that aren't being renamed (they never invoke onSaveEdit). */
const NOOP_SAVE = (): void => {};

/**
 * Which landing this section renders under. `global` is the original Agent Home
 * "Recent Chats" tab (every chat, flat). `project` is the per-project landing's
 * "Project Chats" tab — same component and identical row affordances, scoped
 * data supplied by the caller; the variant only changes the empty-state copy.
 * The section title/count live in the shelf chip above, so the variant never
 * renders a visible heading.
 */
export type RecentChatsVariant = "global" | "project";

interface GlobalRecentChatsSectionProps {
  /** Recent chats supplied by core (global or project-scoped getChatHistoryItems). */
  items: ChatHistoryItem[];
  /**
   * Landing context — drives the empty-state copy only (the shelf owns the
   * visible title). Defaults to `global`, preserving the original behavior.
   */
  variant?: RecentChatsVariant;
  /**
   * Human label for this section (e.g. "Recent Chats" / "Project Chats"). The
   * shelf chip renders the visible title, so this is used only as the section's
   * accessible label. Optional — omit to leave the group unlabeled.
   */
  title?: string;
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
  /**
   * Recent-list ids whose backend turn is running in the background. Matching
   * rows swap their relative-time chip for a spinner. Omitted means "none".
   */
  runningChatIds?: ReadonlySet<string>;
  /**
   * Recent-list ids whose live session is flagging needs-attention. OR'd with
   * each item's baked-in `needsAttention` snapshot so the done-dot appears the
   * moment a backgrounded turn finishes — the snapshot alone goes stale once
   * the list is mounted. Omitted means "snapshot only".
   */
  attentionChatIds?: ReadonlySet<string>;
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
 * leading-slot width. The attention dot mirrors the tab strip's cue for a
 * backgrounded live session that finished / errored — without it the landing
 * list would be the only chat surface hiding the signal (the conversation
 * History popover renders it via the same wrapper).
 */
const ChatIconTile = memo(
  ({
    Icon,
    needsAttention,
  }: {
    Icon: React.ComponentType<{ className?: string }>;
    needsAttention?: boolean;
  }) => (
    <span
      aria-hidden="true"
      className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted"
    >
      <ChatIconWithAttention
        icon={Icon}
        needsAttention={needsAttention}
        iconClassName="tw-size-4"
      />
    </span>
  )
);
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
  /** Whether this chat's backend turn is running in the background. */
  isRunning: boolean;
  /** Snapshot ∪ live needs-attention — drives the icon tile's done-dot. */
  hasAttention: boolean;
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
  isRunning,
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
      <ChatIconTile Icon={Icon} needsAttention={hasAttention} />
      <span
        className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal"
        title={item.title}
      >
        {item.title}
      </span>

      {/* Relative time by default; a backgrounded running session shows an accent
          spinner in its place. The action cluster replaces either on hover or
          keyboard focus so a narrow sidebar doesn't have to fit both. The
          `group-focus-within` path keeps the actions reachable for keyboard
          users (focusing the row reveals them, so Tab can move into them) —
          on hover alone they'd stay `display:none` and out of the tab order. */}
      {isRunning ? (
        <LoaderCircle
          className={cn(
            "tw-size-3.5 tw-shrink-0 tw-animate-spin tw-text-accent",
            "group-focus-within:tw-hidden group-hover:tw-hidden"
          )}
          aria-label="Running"
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
 * "Recent Chats" section for the Agent Home landing. A searchable list whose
 * rows manage chats in place — open, rename, delete, and (for markdown-saved
 * chats only) open the source note — the same affordances as the chat history
 * popover. The inline preview caps at {@link INLINE_LIMIT}; overflow lives
 * behind a "View all chats" trigger that opens the full
 * {@link ChatHistoryPopover}, while searching surfaces every match. Native
 * (autosave-off) sessions appear here too; they just have no source note. The
 * per-project landing reuses it (`variant="project"`) with scoped items and
 * project empty copy — identical rows, no extra chrome.
 */
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
  attentionChatIds,
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

  // Sort once for the inline preview (fixed recent-first, like the rest of the
  // landing); the View-all popover re-sorts the full list by the user's
  // configured chatHistorySortStrategy — the same management surface as the
  // control bar's History button — so it reads raw `items` directly below.
  const sortedItems = useMemo(() => sortChatsByRecent(items), [items]);
  const isSearching = query.trim().length > 0;
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedItems;
    return sortedItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [sortedItems, query]);
  // Inline preview caps at INLINE_LIMIT; a search shows every match (the cap
  // would hide exactly what the user is looking for).
  const visibleItems = useMemo(
    () => (isSearching ? filteredItems : filteredItems.slice(0, INLINE_LIMIT)),
    [filteredItems, isSearching]
  );
  const hasOverflow = !isSearching && filteredItems.length > INLINE_LIMIT;

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

  // Stable references so the memoized rows aren't all re-rendered on every
  // section render (an inline arrow here would defeat RecentChatRow's memo).
  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleCancelDelete = useCallback(() => setConfirmDeleteId(null), []);

  return (
    <div
      role={title ? "group" : undefined}
      aria-label={title}
      // tw-grow fills the shelf panel's fixed floor (AgentHomeShelf) so the
      // empty / no-match copy below can center inside the card instead of
      // hugging the top of a mostly blank panel.
      className={cn("tw-flex tw-grow tw-flex-col tw-gap-2", className)}
    >
      {items.length > 0 && (
        <div className="tw-p-1">
          {/* Compact height so the search row reads as a list utility, not a
              full-size form field towering over the 36px rows below. */}
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
        // Outer divide-y separates the scroll region from the "View all" row
        // below with the same hairline the rows use between themselves — the
        // exact look of the Projects tab, where the trigger sits in the list's
        // divide-y container.
        <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
          {/* max-h-56 keeps a long search-result list scrolling INSIDE the card
              near the inline preview's height, so searching doesn't balloon the
              card. The inline (non-search) 5-row preview never reaches this cap,
              and the "View all" row lives outside the scroll region so it can't
              scroll out of reach. */}
          <ScrollArea className="tw-max-h-56 tw-overflow-y-auto">
            <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
              {visibleItems.map((item) => (
                <RecentChatRow
                  key={item.id}
                  item={item}
                  isEditing={editingId === item.id}
                  // Only the row being renamed needs the live draft; passing a
                  // stable "" to the rest keeps their memo from re-rendering on
                  // every keystroke.
                  editingTitle={editingId === item.id ? editingTitle : ""}
                  confirmingDelete={confirmDeleteId === item.id}
                  onOpen={onLoadChat}
                  onStartEdit={handleStartEdit}
                  onEditingTitleChange={setEditingTitle}
                  // Only the editing row needs the live save handler (it changes
                  // per keystroke via editingTitle); the rest get a stable noop so
                  // their memo isn't defeated mid-rename.
                  onSaveEdit={editingId === item.id ? handleSaveEdit : NOOP_SAVE}
                  onCancelEdit={handleCancelEdit}
                  onStartDelete={setConfirmDeleteId}
                  onConfirmDelete={handleConfirmDelete}
                  onCancelDelete={handleCancelDelete}
                  canOpenSourceFile={!isNativeChatId(item.id)}
                  onOpenSourceFile={handleOpenSourceFile}
                  isRunning={runningChatIds?.has(item.id) ?? false}
                  hasAttention={!!item.needsAttention || (attentionChatIds?.has(item.id) ?? false)}
                />
              ))}
            </div>
          </ScrollArea>
          {hasOverflow && (
            <ChatHistoryPopover
              chatHistory={items}
              onUpdateTitle={onUpdateTitle}
              onDeleteChat={onDeleteChat}
              onLoadChat={onLoadChat}
              onOpenSourceFile={onOpenSourceFile}
              getIcon={resolveChatIcon}
              // Full-width row near the pane's lower half: open downward like
              // an accordion. Radix flips to "top" if the area below is tight.
              side="bottom"
              align="start"
            >
              {/* Trigger styled identically to the Projects tab's "View all
                  projects" row (AgentHomeViewAll) so the two shelf tabs read as
                  one component family.

                  DESIGN NOTE: unlike these inline rows, the popover's rows show
                  the open-source-note action for native (autosave-off) chats
                  too — pre-existing shared ChatHistoryPopover behavior (same
                  exposure as the control bar's History button; the click
                  degrades to a "no saved note" notice). Hiding it would mean a
                  per-row visibility prop on the shared popover — tracked as
                  shared-popover debt, not worth an entry-point hack here.

                  Radix merges its toggle onClick onto this child; Enter/Space
                  dispatch a click so the popover opens for keyboard users
                  without this row owning the popover's open state.

                  DESIGN NOTE: onLoadHistory runs on every toggle (open *and*
                  close), because Radix fires the merged onClick both ways and
                  this row can't see the popover's open state. That's an
                  intentional, harmless refresh — the same pattern the
                  conversation control bar uses on its History button
                  (AgentChatControls). loadChatHistory is mounted-guarded and
                  self-correcting, so a fast open/close race only momentarily
                  shows near-identical data. A "refresh only on open" fix would
                  need ChatHistoryPopover to expose onOpenChange — not worth
                  touching the shared base for this. */}
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-rounded-md tw-px-2 tw-py-1.5",
                  "tw-text-xs tw-text-accent tw-transition-colors hover:tw-bg-modifier-hover hover:tw-text-accent-hover"
                )}
                onClick={() => onLoadHistory?.()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
              >
                <span>View all chats</span>
                <ChevronRight className="tw-size-3 tw-shrink-0" />
              </div>
            </ChatHistoryPopover>
          )}
        </div>
      )}
    </div>
  );
});

GlobalRecentChatsSection.displayName = "GlobalRecentChatsSection";
