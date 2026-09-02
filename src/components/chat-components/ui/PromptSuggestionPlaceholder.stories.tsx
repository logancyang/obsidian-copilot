import {
  PromptSuggestionPlaceholder,
  type PromptSuggestionPlaceholderProps,
} from "@/components/chat-components/ui/PromptSuggestionPlaceholder";
import type { Meta, StoryObj } from "@/lib/story";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import React from "react";

const STORY_PROMPTS = Object.freeze([
  "Summarize what I worked on this week",
  "Find notes that say contradictory things and show me",
]);
const STORY_DESCRIPTION_ID = "gallery-prompt-suggestion";
const STORY_STATIC_PLACEHOLDER = "Ask anything • @ to add context • / for commands";

const meta = {
  title: "Chat/Prompt Suggestion Placeholder",
  component: PromptSuggestionPlaceholder,
  args: {
    prompts: STORY_PROMPTS,
    descriptionId: STORY_DESCRIPTION_ID,
    staticPlaceholder: STORY_STATIC_PLACEHOLDER,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<PromptSuggestionPlaceholderProps>;
export default meta;

/** The operating system's motion preference selects the rotating or static rendering. */
export const LandingComposer: StoryObj<PromptSuggestionPlaceholderProps> = {
  render: (args) => (
    <LexicalComposer
      initialConfig={{
        namespace: "prompt-suggestion-story",
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <div className="tw-text-sm tw-text-muted/60">
        <PromptSuggestionPlaceholder
          prompts={args.prompts ?? STORY_PROMPTS}
          descriptionId={args.descriptionId ?? STORY_DESCRIPTION_ID}
          staticPlaceholder={args.staticPlaceholder ?? STORY_STATIC_PLACEHOLDER}
        />
      </div>
    </LexicalComposer>
  ),
};
