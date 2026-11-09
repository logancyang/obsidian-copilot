import {
  defineChatExtension,
  type ChatStateHost,
  type ChatStateKey,
  type ChatView,
} from "@/agentMode/session/chatExtension";
import type { FeedbackDraft, FeedbackOfferResult } from "@/agentMode/session/copilotMcpServer";
import { AuthRequiredError } from "@/agentMode/session/errors";
import { isProviderSideFailure } from "@/agentMode/session/feedback/providerSideFailure";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";

export interface FeedbackEvidence {
  backendId: string;
  model: string | null;
  sessionId: string | null;
  raisedAt: string;
}

export type FeedbackOfferStatus = "open" | "dismissed" | "reported";

export type FeedbackOfferTrigger = "agent" | "turn_error";

export interface FeedbackOffer {
  trigger: FeedbackOfferTrigger;
  draft: FeedbackDraft;
  evidence: FeedbackEvidence;
  afterUserMessageId: string | null;
  status: FeedbackOfferStatus;
  report?: { reportId: string; issueUrl: string };
}

export function formatFeedbackNote({ trigger, draft, evidence }: FeedbackOffer): string {
  if (trigger === "turn_error") {
    return [draft.title, "", `Error: ${draft.whatHappened}`, "", formatEvidence(evidence)].join(
      "\n"
    );
  }
  const userSaid = draft.userSaid
    ? `"${draft.userSaid}"`
    : "The user didn't comment; the agent raised this.";
  return [
    draft.title,
    "",
    `What happened: ${draft.whatHappened}`,
    "",
    `What the user said: ${userSaid}`,
    "",
    `Steps to reproduce: ${draft.repro}`,
    "",
    formatEvidence(evidence),
  ].join("\n");
}

export function formatChatReportNote(evidence: FeedbackEvidence): string {
  return `\n\n${formatEvidence(evidence)}`;
}

function formatEvidence(evidence: FeedbackEvidence): string {
  return `Evidence: backend ${evidence.backendId} · model ${evidence.model ?? "unknown"} · session ${evidence.sessionId ?? "unknown"} · ${evidence.raisedAt}`;
}

export const FEEDBACK_OFFER: ChatStateKey<FeedbackOffer | null> = Object.freeze({
  id: "feedback-offer",
  initial: null,
});

// One card per session, whatever became of it, so a frustrated user is never nagged.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
export function offerFeedback(chat: ChatStateHost, draft: FeedbackDraft): FeedbackOfferResult {
  if (chat.readChatState(FEEDBACK_OFFER)) return "already_offered";
  chat.updateChatState(FEEDBACK_OFFER, (_, view) => openFeedbackOffer(view, "agent", draft));
  return "shown";
}

export function dismissFeedbackOffer(offer: FeedbackOffer | null): FeedbackOffer | null {
  return offer?.status === "open" ? { ...offer, status: "dismissed" } : offer;
}

// An upload can land after the user closed the dialog and dismissed the card, which must stay dismissed.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
export function markFeedbackReported(
  offer: FeedbackOffer | null,
  report: { reportId: string; issueUrl: string }
): FeedbackOffer | null {
  return offer?.status === "open" ? { ...offer, status: "reported", report } : offer;
}

export const FEEDBACK_OFFER_EXTENSION = defineChatExtension({
  key: FEEDBACK_OFFER,
  // A failed reply leaves no agent turn to raise the card, so the session raises it with the error.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/762
  onTurnFailed: (offer, chat, { errorText, error }) => {
    if (offer || !getSettings().agentMode.offerFeedbackCards) return offer;
    // A missing sign-in is the user's account state, and the error already points at the Sign in button.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/831
    if (error instanceof AuthRequiredError || isProviderSideFailure(error, errorText)) return offer;
    return openFeedbackOffer(chat, "turn_error", {
      title: `Agent Chat reply failed on ${chat.backendId}`,
      whatHappened: errorText,
      userSaid: "",
      repro: "",
    });
  },
});

function openFeedbackOffer(
  chat: ChatView,
  trigger: FeedbackOfferTrigger,
  draft: FeedbackDraft
): FeedbackOffer {
  const userMessages = chat
    .getDisplayMessages()
    .filter((message) => message.sender === USER_SENDER);
  return {
    trigger,
    draft,
    evidence: chat.getReportEvidence(),
    afterUserMessageId: userMessages[userMessages.length - 1]?.id ?? null,
    status: "open",
  };
}
