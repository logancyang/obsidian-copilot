import { FeedbackCard, type FeedbackCardProps } from "@/agentMode/ui/FeedbackCard";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import type { Meta, StoryObj } from "@/lib/story";

const draft: FeedbackOffer = {
  draft: {
    title: 'Replied in Swedish to an English "commit and push"',
    whatHappened: "The agent read a garbled request as Swedish and answered in Swedish.",
    userSaid: "What the fuck? I mean, commit and push. Why do you switch to a different language?",
    repro: '1. Type a garbled "commit and push". 2. Observe the Swedish reply.',
  },
  evidence: {
    backendId: "claude",
    model: "claude-opus-5-5",
    sessionId: "1911da54-5b56-4820-a062-9a7f8f44e74f",
    raisedAt: "2026-10-08T22:13:52.669Z",
  },
  afterUserMessageId: "user-2",
  status: "open",
};

const meta = {
  title: "Agent Mode/Feedback Card",
  component: FeedbackCard,
  args: {
    offer: draft,
    onReview: () => {},
    onDismiss: () => {},
    onTurnOff: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FeedbackCardProps>;
export default meta;

export const Draft: StoryObj<FeedbackCardProps> = {};

export const AgentNoticedMistake: StoryObj<FeedbackCardProps> = {
  args: { offer: { ...draft, draft: { ...draft.draft, userSaid: "" } } },
};

export const LongQuote: StoryObj<FeedbackCardProps> = {
  args: {
    offer: {
      ...draft,
      draft: {
        ...draft.draft,
        userSaid: `${draft.draft.userSaid} `.repeat(6).trim(),
      },
    },
  },
};

export const Sent: StoryObj<FeedbackCardProps> = {
  args: {
    offer: {
      ...draft,
      status: "reported",
      report: {
        reportId: "da3b3782d2a776df9f0bf6fd0ebd570b",
        issueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new",
      },
    },
  },
};
