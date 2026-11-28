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

export const Paused: StoryObj<ChatTranscriptViewportProps> = {
  render: (props) => (
    <div className="tw-flex tw-h-64 tw-flex-col tw-overflow-hidden">
      <ChatTranscriptViewport {...args} {...props} />
    </div>
  ),
};

const markAsObsidianMarkdown = (element: HTMLDivElement | null): void => {
  element?.classList.add("markdown-rendered");
};

const wideTableTranscript = (
  <div className="tw-space-y-4 tw-p-3 tw-text-sm tw-text-normal">
    <p>The paragraphs wrap at the chat width while the table scrolls on its own.</p>
    <div ref={markAsObsidianMarkdown}>
      <table>
        <thead>
          <tr>
            {["Target", "Insight", "Today", "Same day last month", "Source", "Notes"].map(
              (cell) => (
                <th key={cell}>{cell}</th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sign-ups (940)</td>
            <td>rvlpWXKV</td>
            <td>88</td>
            <td>104</td>
            <td>https://us.posthog.com/project/insights/rvlpWXKV-with-a-long-unbreakable-path</td>
            <td>Behind pace</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>A paragraph after the table keeps the same width as the one before it.</p>
  </div>
);

export const WideTable: StoryObj<ChatTranscriptViewportProps> = {
  args: { children: wideTableTranscript, isScrollPaused: false },
  render: (props) => (
    <div className="tw-flex tw-h-64 tw-flex-col tw-overflow-hidden">
      <ChatTranscriptViewport {...args} {...props} />
    </div>
  ),
};

export const Following: StoryObj<ChatTranscriptViewportProps> = {
  args: { isScrollPaused: false },
  render: (props) => (
    <div className="tw-flex tw-h-64 tw-flex-col tw-overflow-hidden">
      <ChatTranscriptViewport {...args} {...props} />
    </div>
  ),
};
