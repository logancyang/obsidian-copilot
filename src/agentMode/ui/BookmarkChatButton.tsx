import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { openBookmarksPluginSettings } from "@/utils/obsidianBookmarks";
import { Bookmark } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface BookmarkChatButtonProps {
  getBookmarkState?: () => Promise<ChatBookmarkState>;
  onSetBookmarked: (bookmarked: boolean) => Promise<void>;
}

export function BookmarkChatButton({ getBookmarkState, onSetBookmarked }: BookmarkChatButtonProps) {
  const app = useApp();
  const [loaded, setLoaded] = useState<{
    read: () => Promise<ChatBookmarkState>;
    state: ChatBookmarkState;
  } | null>(null);
  const requestRef = useRef(0);
  const refresh = useCallback(() => {
    const request = ++requestRef.current;
    const read = getBookmarkState;
    if (!read) return;
    void read().then((state) => {
      if (requestRef.current === request) setLoaded({ read, state });
    });
  }, [getBookmarkState]);
  useEffect(refresh, [refresh]);

  const state = loaded && loaded.read === getBookmarkState ? loaded.state : null;
  if (state === "unavailable") return null;
  const off = state === "off";
  const bookmarked = state === "bookmarked";
  const label = bookmarked ? "Remove Chat Bookmark" : "Bookmark Chat";

  const handleClick = async () => {
    // A turned-off Bookmarks plugin still shows the button, so users can find the feature and how to enable it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
    if (off) {
      openBookmarksPluginSettings(app);
      return;
    }
    await onSetBookmarked(!bookmarked);
    refresh();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          title={label}
          aria-pressed={bookmarked}
          className={cn(off && "tw-opacity-50")}
          disabled={state === null}
          onPointerEnter={refresh}
          onClick={() => void handleClick()}
        >
          <Bookmark className={cn("tw-size-4", bookmarked && "tw-fill-current")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {off
          ? "Turn on the Bookmarks core plugin to bookmark chats. Select to open it in Settings."
          : label}
      </TooltipContent>
    </Tooltip>
  );
}
