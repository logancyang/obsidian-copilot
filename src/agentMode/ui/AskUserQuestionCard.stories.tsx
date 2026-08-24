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

export const MultipleQuestions: StoryObj<AskUserQuestionCardProps> = {};
