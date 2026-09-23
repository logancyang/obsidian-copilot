import {
  ChatTranscriptViewport,
  type ChatTranscriptViewportProps,
} from "@/components/chat-components/ui/ChatTranscriptViewport";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const transcript = (
  <div className="tw-space-y-4 tw-p-3 tw-text-sm tw-text-normal">
    <p>Summarize the main findings in this note.</p>
    {Array.from({ length: 12 }, (_, index) => (
      <p key={index}>Finding {index + 1}: The notes clarify the next step for the project.</p>
    ))}
  </div>
);

const args: ChatTranscriptViewportProps = {
  children: transcript,
  scrollContainerRef: () => undefined,
  contentRef: () => undefined,
  onScroll: () => undefined,
  isScrollPaused: true,
  scrollToEnd: () => undefined,
};

const meta = {
  title: "Chat/Transcript Viewport",
  component: ChatTranscriptViewport,
  args,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ChatTranscriptViewportProps>;
export default meta;

/** The control floats above a long transcript while the reader is scrolled away. */
export const Paused: StoryObj<ChatTranscriptViewportProps> = {
  render: (props) => (
    <div className="tw-flex tw-h-64 tw-flex-col tw-overflow-hidden">
      <ChatTranscriptViewport {...args} {...props} />
    </div>
  ),
};

/** The control is absent while the reader follows the end of a response. */
export const Following: StoryObj<ChatTranscriptViewportProps> = {
  args: { isScrollPaused: false },
  render: (props) => (
    <div className="tw-flex tw-h-64 tw-flex-col tw-overflow-hidden">
      <ChatTranscriptViewport {...args} {...props} />
    </div>
  ),
};
