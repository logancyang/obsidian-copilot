import { BookmarkChatButton, type BookmarkChatButtonProps } from "./BookmarkChatButton";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "Agent/Bookmark Chat",
  component: BookmarkChatButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<BookmarkChatButtonProps>;
export default meta;

const render = (args: BookmarkChatButtonProps) => (
  <TooltipProvider>
    <BookmarkChatButton {...args} />
  </TooltipProvider>
);

const withState = (state: ChatBookmarkState): BookmarkChatButtonProps => ({
  getBookmarkState: async () => state,
  onSetBookmarked: async () => {},
});

export const NotBookmarked: StoryObj<BookmarkChatButtonProps> = {
  args: withState("not-bookmarked"),
  render,
};

export const Bookmarked: StoryObj<BookmarkChatButtonProps> = {
  args: withState("bookmarked"),
  render,
};

export const BookmarksOff: StoryObj<BookmarkChatButtonProps> = {
  args: withState("off"),
  render,
};

export const EmptyChat: StoryObj<BookmarkChatButtonProps> = {
  args: { onSetBookmarked: async () => {} },
  render,
};
