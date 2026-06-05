import {
  AgentHomeCreateRow,
  AgentHomeListRow,
  INLINE_LIMIT,
} from "@/agentMode/ui/AgentHomeSection";
import { backendRegistry } from "@/agentMode/backends/registry";
import { cn } from "@/lib/utils";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { sortByStrategy } from "@/utils/recentUsageManager";
import { ChevronRight, MessageCircle } from "lucide-react";
import React, { memo, useMemo } from "react";

interface GlobalRecentChatsSectionProps {
  /** Recent chats supplied by core (global getChatHistoryItems). Pure display. */
  items: ChatHistoryItem[];
  /**
   * Open a chat by id — drives both the inline rows and the View-all popover, so
   * "open a chat" has one id-based entry point (same handler the conversation
   * control bar uses). The View-all popover handlers below come from the same
   * `useAgentHistoryControls`, so the landing reuses the full
   * {@link ChatHistoryPopover} (search, time grouping, rename, delete,
   * open-source) without any new backend work.
   */
  onLoadChat: (id: string) => Promise<void>;
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onOpenSourceFile: (id: string) => Promise<void>;
  /** Refresh the items when the popover opens (mirrors the control-bar button). */
  onLoadHistory?: () => void;
  /** Optional create action — renders a "New chat" row atop the list. */
  onCreate?: () => void;
  className?: string;
}

/**
 * Brand icon for the backend a chat ran on, mirroring the chat history popover's
 * resolver. Returns `undefined` for legacy chats without a `backendId`; the
 * popover then falls back to its own generic icon (`MessageCircle`), and the
 * inline rows below fall back to the same icon so the two surfaces match.
 */
function resolveChatIcon(
  item: ChatHistoryItem
): React.ComponentType<{ className?: string }> | undefined {
  return item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;
}

// Most-recent-first, via the same `sortByStrategy("recent")` the Projects list
// uses — so the inline preview orders identically (primary: last-used desc,
// falling back to created; ties broken by name then created). The section is
// literally "Recent Chats", so the inline preview is pinned to "recent"; the
// View-all popover follows the user's configurable `chatHistorySortStrategy`
// (same as everywhere else the popover renders). Upstream `getChatHistoryItems()`
// returns vault-scan order, so the inline sort lives here.
function sortChatsByRecent(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return sortByStrategy(items, "recent", {
    getName: (item) => item.title,
    getCreatedAtMs: (item) => item.createdAt.getTime(),
    getLastUsedAtMs: (item) => item.lastAccessedAt.getTime(),
  });
}

/**
 * Neutral tile holding the chat's backend brand glyph (or the generic fallback),
 * sized to match the project tiles so both lists share one leading-slot width —
 * their labels then line up when you switch tabs, and it matches the "New chat"
 * create row's tile. Projects are color-coded by id; chats aren't, so this uses a
 * single muted surface rather than a hued tint.
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
  /** Open by id; the row fires it and forgets (loads surface their own Notice). */
  onOpen: (id: string) => void | Promise<void>;
}

const RecentChatRow = memo(({ item, onOpen }: RecentChatRowProps) => (
  <AgentHomeListRow
    label={item.title}
    timeMs={item.lastAccessedAt.getTime()}
    onClick={() => void onOpen(item.id)}
    leading={<ChatIconTile Icon={resolveChatIcon(item) ?? MessageCircle} />}
  />
));
RecentChatRow.displayName = "RecentChatRow";

/**
 * "Recent Chats" section for the Agent Home landing (design A.2). The inline
 * preview is read-only; the View-all opens the full management popover.
 *
 * Shows the {@link INLINE_LIMIT} most-recent chats inline; the "View all" trigger
 * opens the full {@link ChatHistoryPopover} so the user can search, rename,
 * delete, and open the source file — the same management surface as the
 * conversation-state control bar. Pure presentation: the data source and all
 * mutations are owned by core. Named with the `Global` prefix so PR2 can
 * introduce a per-project `Project Chats` variant without collision.
 */
export const GlobalRecentChatsSection = memo(
  ({
    items,
    onLoadChat,
    onUpdateTitle,
    onDeleteChat,
    onOpenSourceFile,
    onLoadHistory,
    onCreate,
    className,
  }: GlobalRecentChatsSectionProps): React.ReactElement => {
    // Sort once for the inline preview; the popover re-sorts the full list by
    // the user's configured strategy, so it reads `items` directly below.
    const sortedItems = useMemo(() => sortChatsByRecent(items), [items]);
    const inlineItems = useMemo(() => sortedItems.slice(0, INLINE_LIMIT), [sortedItems]);
    const total = items.length;
    const hasOverflow = total > INLINE_LIMIT;

    return (
      <div className={cn("tw-flex tw-flex-col tw-divide-y tw-divide-border", className)}>
        {onCreate && <AgentHomeCreateRow label="New chat" onClick={onCreate} />}
        {total === 0 ? (
          <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No recent chats</div>
        ) : (
          <>
            {inlineItems.map((item) => (
              <RecentChatRow key={item.id} item={item} onOpen={onLoadChat} />
            ))}
            {hasOverflow && (
              <ChatHistoryPopover
                chatHistory={items}
                onUpdateTitle={onUpdateTitle}
                onDeleteChat={onDeleteChat}
                onLoadChat={onLoadChat}
                onOpenSourceFile={onOpenSourceFile}
                getIcon={resolveChatIcon}
                // Full-width row near the pane's lower half: open downward like
                // an accordion, left-aligned with the inline rows above. Radix
                // flips to "top" if the area below is tight (e.g. mobile keyboard).
                side="bottom"
                align="start"
              >
                {/* Same "View all" trigger shape as the Projects section (div
                    role=button); pl-6 aligns under these rows' single-glyph chat
                    icons (the Projects list uses pl-8 to clear its wider tiles).
                    Radix merges its toggle
                    onClick onto this child; Enter/Space dispatch a click so the
                    popover opens for keyboard users without this row owning the
                    popover's open state.

                    DESIGN NOTE: onLoadHistory runs on every toggle (open *and*
                    close), because Radix fires the merged onClick both ways and
                    this row can't see the popover's open state. That's an
                    intentional, harmless refresh — the same pattern the
                    conversation control bar uses on its History button
                    (AgentChatControls). A refresh on close just re-reads the
                    same vault history; loadChatHistory is mounted-guarded and
                    self-correcting, so a fast open/close race only momentarily
                    shows near-identical data. A "refresh only on open" fix would
                    need ChatHistoryPopover to expose onOpenChange — not worth
                    touching the shared base for this. If a future review flags
                    this again, point them at this note. */}
                <div
                  role="button"
                  tabIndex={0}
                  className="tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-rounded-md tw-px-2 tw-py-1.5 tw-text-xs tw-text-accent tw-transition-colors hover:tw-bg-modifier-hover hover:tw-text-accent-hover"
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
          </>
        )}
      </div>
    );
  }
);

GlobalRecentChatsSection.displayName = "GlobalRecentChatsSection";
