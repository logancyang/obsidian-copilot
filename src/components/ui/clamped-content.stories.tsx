import { ClampedContent, type ClampedContentProps } from "@/components/ui/clamped-content";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "Chat/Clamped Content",
  component: ClampedContent,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ClampedContentProps>;
export default meta;

const LONG_PROMPT = `I want to brainstorm an idea with you. Right now I have new data coming in from several places while maintaining the community: new issues on GitHub, new posts in the feedback channel, and the occasional long thread that never gets read twice.

I would like a local routine that studies the codebase, checks the other open issues, collects whatever context it needs, and drafts a reply worth sending.

Because the feedback is public, I do not want the bot to post anything as-is. I want it to hold its draft, explain what it based the draft on, and wait for a human to agree before anything leaves the machine.

The failure mode I am trying to avoid is the one where the agent quietly finishes, raises nothing, and nobody ever learns that a job was stuck. Silence should not be the same signal as success.

So the shape I am after is: gather, draft, surface, wait. The surfacing step is the one every tool I have tried so far gets wrong.`;

const MessageBubble: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2">
    <div className="tw-whitespace-pre-wrap tw-break-words !tw-leading-[1.6]">{children}</div>
  </div>
);

/** A pasted prompt collapses to its first lines until the reader opens it. */
export const Collapsed: StoryObj<ClampedContentProps> = {
  render: () => (
    <MessageBubble>
      <ClampedContent collapsedClassName="tw-max-h-[12lh]">{LONG_PROMPT}</ClampedContent>
    </MessageBubble>
  ),
};

/** A short message stays exactly as written, with no control added. */
export const FitsWithoutControl: StoryObj<ClampedContentProps> = {
  render: () => (
    <MessageBubble>
      <ClampedContent collapsedClassName="tw-max-h-[12lh]">
        Summarize the notes I touched this week and group them by project.
      </ClampedContent>
    </MessageBubble>
  ),
};

/** A tight budget shows how little content the clamp can leave visible. */
export const ThreeLineClamp: StoryObj<ClampedContentProps> = {
  render: () => (
    <MessageBubble>
      <ClampedContent collapsedClassName="tw-max-h-[3lh]">{LONG_PROMPT}</ClampedContent>
    </MessageBubble>
  ),
};
