import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useApp } from "@/context";
import { openBookmarksPluginSettings } from "@/utils/obsidianBookmarks";
import { Bookmark, BookmarkMinus, Info } from "lucide-react";
import React, { useEffect, useState } from "react";

export interface ChatBookmarkMenuItemProps {
  getBookmarkState: () => Promise<ChatBookmarkState>;
  onSetBookmarked: (bookmarked: boolean) => void;
}

export function ChatBookmarkMenuItem({
  getBookmarkState,
  onSetBookmarked,
}: ChatBookmarkMenuItemProps): React.ReactElement | null {
  const app = useApp();
  const [state, setState] = useState<ChatBookmarkState | null>(null);
  useEffect(() => {
    let current = true;
    void getBookmarkState().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [getBookmarkState]);

  // A turned-off Bookmarks plugin still shows the item, so users can find the feature and how to enable it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
  if (state === "off") {
    return (
      <DropdownMenuItem
        className="tw-text-faint focus:tw-text-faint"
        onSelect={() => openBookmarksPluginSettings(app)}
      >
        <Bookmark />
        Add to bookmarks
        <span className="tw-ml-auto">
          <HelpTooltip
            side="bottom"
            contentClassName="tw-max-w-60"
            content="Turn on the Bookmarks core plugin to bookmark chats. Select to open it in Settings."
          >
            <Info className="tw-size-3.5" aria-label="Bookmarks is turned off" />
          </HelpTooltip>
        </span>
      </DropdownMenuItem>
    );
  }
  if (state !== "bookmarked" && state !== "not-bookmarked") return null;
  const bookmarked = state === "bookmarked";
  return (
    <DropdownMenuItem onSelect={() => onSetBookmarked(!bookmarked)}>
      {bookmarked ? <BookmarkMinus /> : <Bookmark />}
      {bookmarked ? "Remove from bookmarks" : "Add to bookmarks"}
    </DropdownMenuItem>
  );
}
