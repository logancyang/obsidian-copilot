import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FeedbackCard, feedbackCardSlot } from "./FeedbackCard";
import { FEEDBACK_OFFER, type FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type CopilotPlugin from "@/main";

const mockOpenReportIssueModal = jest.fn();
jest.mock("@/agentMode/ui/ReportIssueModal", () => ({
  openReportIssueModal: (...args: unknown[]) => mockOpenReportIssueModal(...args),
}));
const mockSetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/settings/model"),
  setSettings: (...args: unknown[]) => mockSetSettings(...args),
}));

const PLUGIN = { manifest: { version: "4.1.0" } } as unknown as CopilotPlugin;

const OPEN_OFFER: FeedbackOffer = {
  trigger: "agent",
  draft: {
    title: "Replied in Swedish to an English request",
    whatHappened: "The agent answered 'hej'.",
    userSaid: "Why do you switch to a different language?",
    repro: "1. Ask in English.",
  },
  evidence: { backendId: "codex", model: "gpt-6.1-sol", sessionId: "s-1", raisedAt: "t" },
  afterUserMessageId: "user-2",
  status: "open",
};

function renderCard(offer: FeedbackOffer = OPEN_OFFER) {
  const props = { offer, onReview: jest.fn(), onDismiss: jest.fn(), onTurnOff: jest.fn() };
  render(<FeedbackCard {...props} />);
  return props;
}

describe("FeedbackCard", () => {
  describe("FeedbackCard()", () => {
    it("shows the drafted title and the user's own words with review, dismiss and opt-out actions", () => {
      renderCard();

      expect(screen.getByText("Report this to the Copilot team?")).toBeTruthy();
      expect(screen.getByText(OPEN_OFFER.draft.title)).toBeTruthy();
      expect(screen.getByText(`You said: “${OPEN_OFFER.draft.userSaid}”`)).toBeTruthy();
    });

    it.each([
      ["Review & report", "onReview"],
      ["Dismiss", "onDismiss"],
      ["Don't offer again", "onTurnOff"],
    ] as const)("hands the %s click to %s only", (name, own) => {
      const props = renderCard();

      fireEvent.click(screen.getByRole("button", { name }));

      for (const callback of ["onReview", "onDismiss", "onTurnOff"] as const) {
        expect(props[callback]).toHaveBeenCalledTimes(callback === own ? 1 : 0);
      }
    });

    it("omits the quote when the agent raised the problem itself", () => {
      renderCard({ ...OPEN_OFFER, draft: { ...OPEN_OFFER.draft, userSaid: "" } });

      expect(screen.queryByText(/You said/)).toBeNull();
    });

    it("confirms a sent report with its ID and a link to the GitHub issue, without the draft actions", () => {
      renderCard({
        ...OPEN_OFFER,
        status: "reported",
        report: { reportId: "da3b3782", issueUrl: "https://github.com/x/y/issues/new" },
      });

      expect(screen.getByText("Report sent to the Copilot team")).toBeTruthy();
      expect(screen.getByText("da3b3782")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open the GitHub issue" }).getAttribute("href")).toBe(
        "https://github.com/x/y/issues/new"
      );
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("feedbackCardSlot", () => {
    describe("place()", () => {
      it("places an open or sent card after the turn that raised it", () => {
        expect(feedbackCardSlot.place(OPEN_OFFER)).toEqual([
          { id: "offer", afterUserMessageId: "user-2" },
        ]);
        expect(feedbackCardSlot.place({ ...OPEN_OFFER, status: "reported" })).toHaveLength(1);
      });

      it("places nothing when there is no offer or it was dismissed", () => {
        expect(feedbackCardSlot.place(null)).toEqual([]);
        expect(feedbackCardSlot.place({ ...OPEN_OFFER, status: "dismissed" })).toEqual([]);
      });
    });

    describe("render()", () => {
      function renderSlot() {
        const chat = fakeChat();
        chat.updateChatState(FEEDBACK_OFFER, () => OPEN_OFFER);
        render(<>{feedbackCardSlot.render(OPEN_OFFER, "offer", { plugin: PLUGIN, chat })}</>);
        return chat;
      }

      beforeEach(() => {
        mockOpenReportIssueModal.mockClear();
        mockSetSettings.mockClear();
      });

      it("opens the report dialog prefilled from the card with every source checked, and records the sent report on the chat's card", () => {
        const chat = renderSlot();

        fireEvent.click(screen.getByRole("button", { name: "Review & report" }));

        expect(mockOpenReportIssueModal).toHaveBeenCalledWith(PLUGIN, {
          activeBackend: "codex",
          initialNote: expect.stringMatching(/^Replied in Swedish to an English request\n/),
          preselectAllSources: true,
          onReported: expect.any(Function),
        });
        const { onReported } = mockOpenReportIssueModal.mock.calls[0][1] as {
          onReported: (report: { reportId: string; issueUrl: string }) => void;
        };
        onReported({ reportId: "r1", issueUrl: "https://example.com" });
        expect(chat.readChatState(FEEDBACK_OFFER)).toMatchObject({
          status: "reported",
          report: { reportId: "r1", issueUrl: "https://example.com" },
        });
      });

      it("dismisses the chat's card without opening the report dialog", () => {
        const chat = renderSlot();

        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(chat.readChatState(FEEDBACK_OFFER)?.status).toBe("dismissed");
        expect(mockOpenReportIssueModal).not.toHaveBeenCalled();
      });

      it("turns feedback cards off and dismisses this one when the user opts out", () => {
        const chat = renderSlot();

        fireEvent.click(screen.getByRole("button", { name: "Don't offer again" }));

        const update = mockSetSettings.mock.calls[0][0] as (cur: {
          agentMode: Record<string, unknown>;
        }) => { agentMode: Record<string, unknown> };
        expect(update({ agentMode: { debugFullFrames: true } }).agentMode).toEqual({
          debugFullFrames: true,
          offerFeedbackCards: false,
        });
        expect(chat.readChatState(FEEDBACK_OFFER)?.status).toBe("dismissed");
      });
    });
  });
});
