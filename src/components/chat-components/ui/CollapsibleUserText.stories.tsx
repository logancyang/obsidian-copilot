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
- Mark passages that need a second reading.
- Compare the main argument across the three chapters.
- Write down one question before each discussion.
- Note any examples that clarify a difficult concept.
- Save optional readings for a later session.
- Group related questions under short headings.
- Identify one idea to revisit at the end of the week.
- Add definitions for recurring technical terms.
- Record where two authors disagree.
- Keep a separate list of practical examples.
- Highlight claims that need an outside source.
- Choose one chapter for a closer reread.
- Summarize each discussion in two sentences.
- Leave space for comments from other readers.
- Note which questions remain unresolved.
- Add a short recap after the final chapter.
- Select three quotations for the group discussion.
- List any assumptions shared by the authors.
- Separate factual questions from interpretation.
- Identify the clearest example in each chapter.
- Add one counterexample for each main claim.
- Note connections to earlier readings.
- Record questions that need more context.
- Compare the conclusions in a short table.
- Flag terms that authors use differently.
- Choose one idea for a follow-up exercise.
- Write a one-sentence takeaway for each section.
- List sources mentioned for further reading.
- Mark ideas that changed during the discussion.
- Add a closing question for the next session.

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
