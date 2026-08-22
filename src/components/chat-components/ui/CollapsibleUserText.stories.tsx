import {
  CollapsibleUserText,
  type CollapsibleUserTextProps,
} from "@/components/chat-components/ui/CollapsibleUserText";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const LONG_PROMPT = `Please organize these sample meeting notes into a short checklist.

Discussion topics
- Review the reading list for next week.
- Choose three chapters for the first session.
- Set aside time for questions after each chapter.
- Prepare a one-paragraph summary of each reading.
- Collect unfamiliar terms in a shared glossary.

Follow-up
- Draft the checklist in priority order.
- Keep each item brief and actionable.
- Add a final reminder to review the notes together.`;

function UserBubble({ children }: CollapsibleUserTextProps) {
  return (
    <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2">
      <CollapsibleUserText>
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-font-normal">
          {children}
        </div>
      </CollapsibleUserText>
    </div>
  );
}

const meta = {
  title: "Chat/Collapsible User Text",
  component: CollapsibleUserText,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<CollapsibleUserTextProps>;
export default meta;

export const Short: StoryObj<CollapsibleUserTextProps> = {
  args: { children: "Summarize the active note." },
  render: (args) => <UserBubble>{args.children}</UserBubble>,
};

export const Overflowing: StoryObj<CollapsibleUserTextProps> = {
  args: { children: LONG_PROMPT },
  render: (args) => <UserBubble>{args.children}</UserBubble>,
};
