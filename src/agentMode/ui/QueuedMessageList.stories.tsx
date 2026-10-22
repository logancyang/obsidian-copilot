import type { ComponentProps } from "react";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import type { Meta, StoryObj } from "@/lib/story";

type Props = ComponentProps<typeof QueuedMessageList>;

const meta = {
  title: "Agent/Queued messages",
  component: QueuedMessageList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { delivering: [], held: [], onRemove: () => {} },
} satisfies Meta<Props>;
export default meta;

export const ImageOnly: StoryObj<Props> = {
  args: {
    held: [
      {
        id: "image",
        text: "",
        rawInput: "",
        promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
      },
    ],
  },
};

export const ReadAtNextStep: StoryObj<Props> = {
  args: {
    delivering: [
      { id: "steer-1", text: "Only summarize the first two notes." },
      { id: "steer-2", text: "Keep each summary to one line." },
    ],
  },
};

export const ReadAtNextStepWithWithdraw: StoryObj<Props> = {
  args: {
    delivering: [
      { id: "steer-1", text: "Only summarize the first two notes." },
      { id: "steer-2", text: "Keep each summary to one line." },
    ],
    onWithdraw: () => {},
  },
};

export const HeldUntilAgentFinishes: StoryObj<Props> = {
  args: {
    held: [
      {
        id: "held-1",
        text: "Now list the open questions.",
        rawInput: "Now list the open questions.",
      },
    ],
  },
};

export const ReadAtNextStepAndHeld: StoryObj<Props> = {
  args: {
    delivering: [{ id: "steer", text: "Only summarize the first two notes." }],
    held: [{ id: "compact", text: "/compact", rawInput: "/compact" }],
  },
};
