import {
  dismissFeedbackOffer,
  FEEDBACK_OFFER,
  formatFeedbackNote,
  markFeedbackReported,
  type FeedbackOffer,
} from "@/agentMode/session/feedback/feedbackOffer";
import { defineChatCardSlot, NO_PLACED_CHAT_CARDS } from "@/agentMode/ui/chatCards";
import { openReportIssueModal } from "@/agentMode/ui/ReportIssueModal";
import { Button } from "@/components/ui/button";
import { setSettings } from "@/settings/model";
import { Check, MessageSquareWarning } from "lucide-react";
import React from "react";

export interface FeedbackCardProps {
  offer: FeedbackOffer;
  onReview: () => void;
  onDismiss: () => void;
  onTurnOff: () => void;
}

export const FeedbackCard: React.FC<FeedbackCardProps> = ({
  offer,
  onReview,
  onDismiss,
  onTurnOff,
}) => {
  const { draft, report } = offer;
  return (
    <div
      data-testid="agent-feedback-card"
      className="tw-mx-3 tw-my-2 tw-w-[calc(100%-1.5rem)] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary"
    >
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2">
        {report ? (
          <Check className="tw-size-4 tw-shrink-0 tw-text-success" />
        ) : (
          <MessageSquareWarning className="tw-size-4 tw-shrink-0 tw-text-accent" />
        )}
        <div className="tw-truncate tw-text-sm tw-font-medium">
          {report ? "Report sent to the Copilot team" : "Report this to the Copilot team?"}
        </div>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-py-2 tw-text-sm">
        <div className="tw-break-words">{draft.title}</div>
        {!report && draft.userSaid ? (
          <div className="tw-line-clamp-2 tw-break-words tw-text-muted">
            You said: “{draft.userSaid}”
          </div>
        ) : null}
        {report ? (
          <div className="tw-text-muted">
            Report ID{" "}
            <span className="tw-break-all tw-font-mono tw-text-normal">{report.reportId}</span>
          </div>
        ) : null}
      </div>

      <div className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-px-3 tw-py-2">
        {report ? (
          <a href={report.issueUrl} className="tw-text-xs">
            Open the GitHub issue
          </a>
        ) : (
          <>
            <Button variant="ghost2" size="sm" className="tw-px-0" onClick={onTurnOff}>
              Don&apos;t offer again
            </Button>
            <div className="tw-ml-auto tw-flex tw-gap-2">
              <Button variant="secondary" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
              <Button variant="default" size="sm" onClick={onReview}>
                Review & report
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const feedbackCardSlot = defineChatCardSlot({
  key: FEEDBACK_OFFER,
  place: (offer) =>
    offer && offer.status !== "dismissed"
      ? [{ id: "offer", afterUserMessageId: offer.afterUserMessageId }]
      : NO_PLACED_CHAT_CARDS,
  render: (offer, _cardId, { plugin, chat }) =>
    offer && (
      <FeedbackCard
        offer={offer}
        onReview={() =>
          openReportIssueModal(plugin, {
            activeBackend: offer.evidence.backendId,
            initialNote: formatFeedbackNote(offer),
            preselectAllSources: true,
            onReported: (report) =>
              chat.updateChatState(FEEDBACK_OFFER, (current) =>
                markFeedbackReported(current, report)
              ),
          })
        }
        onDismiss={() => chat.updateChatState(FEEDBACK_OFFER, dismissFeedbackOffer)}
        onTurnOff={() => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, offerFeedbackCards: false },
          }));
          chat.updateChatState(FEEDBACK_OFFER, dismissFeedbackOffer);
        }}
      />
    ),
});
