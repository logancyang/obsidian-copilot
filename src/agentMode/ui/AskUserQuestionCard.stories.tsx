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

/** Answer with Next, or select Checks early to inspect the disabled final Submit state. */
export const MultipleQuestions: StoryObj<AskUserQuestionCardProps> = {};

/** A Codex prompt such as the skill MCP-install question, which accepts only its listed options. */
export const WithoutOther: StoryObj<AskUserQuestionCardProps> = {
  args: {
    request: {
      sessionId: "gallery-session",
      requestId: "gallery-without-other",
      questions: [
        {
          header: "Install MCP servers?",
          question:
            "The selected skill needs MCP servers that are not installed yet. Install them now?",
          answerKey: "mcp_install",
          options: [
            { label: "Install", description: "Install and enable the missing MCP servers." },
            { label: "Skip", description: "Skip installation for now." },
          ],
          allowOther: false,
        },
      ],
    },
  },
};
