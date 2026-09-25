import { CopyChatLinkButton, type CopyChatLinkButtonProps } from "./CopyChatLinkButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "Chat/Copy Chat Link",
  component: CopyChatLinkButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<CopyChatLinkButtonProps>;
export default meta;

const render = (args: CopyChatLinkButtonProps) => (
  <TooltipProvider>
    <CopyChatLinkButton {...args} />
  </TooltipProvider>
);

export const Saved: StoryObj<CopyChatLinkButtonProps> = {
  args: { chatId: "conversations/chat.md", onCopyLink: () => {} },
  render,
};

export const Unsaved: StoryObj<CopyChatLinkButtonProps> = {
  args: { onCopyLink: () => {} },
  render,
};
