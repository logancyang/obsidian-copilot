import { backendRegistry } from "@/agentMode/backends/registry";
import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { RenameChatModal } from "@/agentMode/ui/RenameChatModal";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context";
import { describeChatDelete, describeChatsDelete } from "@/lib/chatDeleteText";
import { cn } from "@/lib/utils";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import {
  Archive,
  FileText,
  Link,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Power,
  Trash2,
} from "lucide-react";
import React, { forwardRef, useCallback, useState } from "react";

// A selected row must read differently from the open chat's row, which already carries the accent tint.
// https://github.com/logancyang/obsidian-copilot/issues/3553
export const SELECTED_CHAT_ROW_CLASS = cn(
  "tw-bg-interactive-accent-hsl/20 tw-ring-1 tw-ring-inset tw-ring-ring hover:tw-bg-interactive-accent-hsl/20"
);

export function isPinned(item: ChatHistoryItem): boolean {
  return item.pinnedAt !== undefined;
}

export interface RecentChatActions {
  onUpdateTitle: (id: string, newTitle: string) => Promise<void>;
  onCopyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  onSetChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onOpenSourceFile: (id: string) => void;
  onCloseSession?: (id: string) => Promise<void>;
  onSetChatPinned: (id: string, pinned: boolean, pinnedAt?: number) => Promise<void>;
  onSetChatArchived: (id: string, archived: boolean) => Promise<void>;
  onDeleteChats: (ids: readonly string[]) => Promise<void>;
  onArchiveChats: (ids: readonly string[]) => Promise<void>;
}

interface RowActionButtonProps extends React.ComponentPropsWithoutRef<typeof Button> {
  label: string;
}

export const RowActionButton = forwardRef<HTMLButtonElement, RowActionButtonProps>(
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
  selectedItems?: readonly ChatHistoryItem[];
}

function agentOf(item: ChatHistoryItem) {
  return item.backendId ? backendRegistry[item.backendId] : undefined;
}

interface SelectedChatsMenuItemsProps {
  items: readonly ChatHistoryItem[];
  onDeleteChats: (ids: readonly string[]) => Promise<void>;
  onArchiveChats: (ids: readonly string[]) => Promise<void>;
}

function SelectedChatsMenuItems({
  items,
  onDeleteChats,
  onArchiveChats,
}: SelectedChatsMenuItemsProps): React.ReactElement {
  const app = useApp();
  const ids = items.map((item) => item.id);
  const count = `${items.length} chats`;
  return (
    <>
      <DropdownMenuItem
        onSelect={() =>
          new ConfirmModal(
            app,
            () => onArchiveChats(ids),
            `Archive ${count}? You can find them under View archived.`,
            `Archive ${count}`,
            "Archive",
            "Cancel"
          ).open()
        }
      >
        <Archive />
        Archive {count}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="tw-text-error focus:tw-text-error"
        onSelect={() =>
          new ConfirmModal(
            app,
            () => onDeleteChats(ids),
            describeChatsDelete(items.map(agentOf)),
            `Delete ${count}`,
            "Delete",
            "Cancel"
          ).open()
        }
      >
        <Trash2 />
        Delete {count}
      </DropdownMenuItem>
    </>
  );
}

export function RecentChatMenu({
  item,
  isNoteBacked,
  isSessionOpen,
  open,
  onOpenChange,
  selectedItems,
  actions: {
    onUpdateTitle,
    onCopyChatLink,
    getChatBookmarkState,
    onSetChatBookmarked,
    onDeleteChat,
    onOpenSourceFile,
    onCloseSession,
    onSetChatPinned,
    onSetChatArchived,
    onDeleteChats,
    onArchiveChats,
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
      {/* Closing hides More actions with the row's hover actions, so a menu still fading out would lose its anchor and jump to the window corner.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
      {open && (
        <DropdownMenuContent
          align="end"
          container={rowBody}
          onClick={(event) => event.stopPropagation()}
        >
          {/* A row inside a multi-chat selection offers only what applies to every selected chat at once.
              https://github.com/logancyang/obsidian-copilot/issues/3553 */}
          {selectedItems && selectedItems.length > 1 ? (
            <SelectedChatsMenuItems
              items={selectedItems}
              onDeleteChats={onDeleteChats}
              onArchiveChats={onArchiveChats}
            />
          ) : (
            <>
              <DropdownMenuItem
                onSelect={() => safeAsyncHandler(onSetChatPinned)(item.id, !pinned)}
              >
                {pinned ? <PinOff /> : <Pin />}
                {pinned ? "Unpin chat" : "Pin chat"}
              </DropdownMenuItem>
              {isNoteBacked && (
                <DropdownMenuItem onSelect={() => onOpenSourceFile(item.id)}>
                  <FileText />
                  Open chat note
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  new RenameChatModal(app, item.title, (title) =>
                    onUpdateTitle(item.id, title)
                  ).open()
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
              <DropdownMenuItem onSelect={() => safeAsyncHandler(onSetChatArchived)(item.id, true)}>
                <Archive />
                Archive chat
              </DropdownMenuItem>
              {isSessionOpen && onCloseSession && (
                <DropdownMenuItem onSelect={() => safeAsyncHandler(onCloseSession)(item.id)}>
                  <Power />
                  Shut down
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="tw-text-error focus:tw-text-error"
                onSelect={() =>
                  new ConfirmModal(
                    app,
                    () => onDeleteChat(item.id),
                    describeChatDelete(agentOf(item)),
                    "Delete chat",
                    "Delete",
                    "Cancel"
                  ).open()
                }
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
