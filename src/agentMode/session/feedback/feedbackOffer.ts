import {
  defineChatExtension,
  type ChatStateHost,
  type ChatStateKey,
  type ChatView,
} from "@/agentMode/session/chatExtension";
import type { FeedbackDraft, FeedbackOfferResult } from "@/agentMode/session/copilotMcpServer";
import { AgentReportedError, AuthRequiredError } from "@/agentMode/session/errors";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { describeConnectorTool } from "@/connectors/connectorTools";
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
  let result: FeedbackOfferResult = "shown";
  chat.updateChatState(FEEDBACK_OFFER, (offer, view) => {
    if (!latestFailureIsNotCopilots(view.getDisplayMessages())) {
      return openFeedbackOffer(view, "agent", draft);
    }
    result = "not_copilot";
    return offer;
  });
  return result;
}

// Agents report any failing tool as a Copilot failure, but a tool Copilot doesn't run, a connected service included, fails for reasons Copilot cannot fix.
// A Copilot tool used after that failure can still be the problem without failing itself, such as one that hangs.
// https://github.com/logancyang/obsidian-copilot/issues/4483
function latestFailureIsNotCopilots(messages: readonly AgentChatMessage[]): boolean {
  const lastUserIndex = messages.map(({ sender }) => sender).lastIndexOf(USER_SENDER);
  const relevant = messages
    .slice(lastUserIndex + 1)
    .flatMap(({ parts }) => parts ?? [])
    .filter(
      (part) => part.kind === "tool_call" && (part.status === "failed" || ranCopilotTool(part))
    );
  const latest = relevant[relevant.length - 1];
  return latest !== undefined && !ranCopilotTool(latest);
}

function ranCopilotTool(part: AgentMessagePart): boolean {
  return (
    part.kind === "tool_call" &&
    (part.copilotTools?.calls.some(({ name }) => !describeConnectorTool(name)) ?? false)
  );
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
    // Only failures Copilot produced earn a card; the agent's own reports name its provider, model or service, and new kinds keep appearing.
    // https://github.com/logancyang/obsidian-copilot/issues/4483
    if (error instanceof AuthRequiredError || error instanceof AgentReportedError) return offer;
    return openFeedbackOffer(chat, "turn_error", {
      title: `Chat reply failed on ${chat.backendId}`,
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
