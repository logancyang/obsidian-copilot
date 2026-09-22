import { CloseSessionButton } from "@/components/chat-components/ui/OpenSessionControls";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof CloseSessionButton>;
const meta = {
  title: "Chat/Open Session Controls",
  component: CloseSessionButton,
  args: { chatId: "research", onCloseSession: async () => {} },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Default: StoryObj<Props> = {};
export const Pending: StoryObj<Props> = {
  args: { onCloseSession: () => new Promise(() => {}) },
};
export const FailedClose: StoryObj<Props> = {
  args: {
    onCloseSession: async () => {
      throw new Error("Backend unavailable");
    },
  },
};
