import { QueuedMessageList } from "@/agentMode/ui/AgentChatInput";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type QueuedMessageListProps = React.ComponentProps<typeof QueuedMessageList>;

const meta = {
  title: "Agent Mode/Queued Message List",
  component: QueuedMessageList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onRemove: () => undefined },
} satisfies Meta<QueuedMessageListProps>;
export default meta;

/**
 * A request the publish command handed to a chat that is still starting. It
 * has no queue reason, so it renders as a plain waiting row until the chat is
 * idle and the composer sends it.
 */
export const CommandHandoffWhileStarting: StoryObj<QueuedMessageListProps> = {
  args: {
    messages: [
      {
        id: "handoff",
        text: 'Publish this Markdown note to OpenArtifacts. Use its exact vault-relative path:\n\n"Notes/Weekly review.md"',
        rawInput: "",
      },
    ],
  },
};

export const TypedFollowUpBehindRunningTurn: StoryObj<QueuedMessageListProps> = {
  args: {
    messages: [
      {
        id: "busy",
        text: "Also add a summary section at the top.",
        rawInput: "Also add a summary section at the top.",
        queueReason: "busy",
      },
    ],
  },
};

export const HeldForProjectContext: StoryObj<QueuedMessageListProps> = {
  args: {
    messages: [
      {
        id: "context",
        text: "List the open questions from the design doc.",
        rawInput: "List the open questions from the design doc.",
        queueReason: "context",
      },
    ],
  },
};
