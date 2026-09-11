import {
  CloseSessionButton,
  OpenSessionIndicator,
} from "@/components/chat-components/ui/OpenSessionControls";
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

export const OpenIdle: StoryObj<Props> = {
  render: (args) => (
    <div className="tw-flex tw-items-center tw-gap-2">
      <OpenSessionIndicator />
      <span>Research notes</span>
      <CloseSessionButton {...meta.args} {...args} />
    </div>
  ),
};
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
