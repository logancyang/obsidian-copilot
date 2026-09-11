import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import type { AskUserQuestionPrompt, SessionId } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AskUserQuestionCardProps = React.ComponentProps<typeof AskUserQuestionCard>;

const request = {
  sessionId: "gallery-session" as SessionId,
  requestId: "gallery-question",
  questions: [
    {
      header: "Deployment",
      question: "Choose deployment",
      options: [{ label: "Production" }, { label: "Staging" }],
    },
    {
      header: "Timing",
      question: "When should we ship?",
      options: [{ label: "Today" }, { label: "Next week" }],
    },
    {
      header: "Checks",
      question: "Which checks are required?",
      multiSelect: true,
      options: [{ label: "Unit tests" }, { label: "End-to-end test" }],
    },
  ],
} satisfies AskUserQuestionPrompt;

const meta = {
  title: "Agent Mode/Ask User Question Card",
  component: AskUserQuestionCard,
  args: {
    request,
    onResolve: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AskUserQuestionCardProps>;
export default meta;

/** Answer with Next, revisit an answered tab, or select Checks early to inspect final Submit. */
export const MultipleQuestions: StoryObj<AskUserQuestionCardProps> = {};

/** Multiple steps with verbose choices keep progress and submission visible while scrolling. */
export const LongChoices: StoryObj<AskUserQuestionCardProps> = {
  args: {
    request: {
      ...request,
      questions: [
        request.questions[0],
        {
          header: "Rollout",
          question: "Which rollout strategy should I use?",
          options: Array.from({ length: 8 }, (_, index) => ({
            label: `Strategy ${index + 1}: staged rollout with regional validation`,
            description:
              "Validate telemetry, rollback readiness, and user impact before expanding to the next region.",
          })),
        },
      ],
    },
  },
};
