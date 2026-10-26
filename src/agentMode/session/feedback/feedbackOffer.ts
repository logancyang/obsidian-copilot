import type { FeedbackDraft } from "@/agentMode/session/copilotMcpServer";

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
