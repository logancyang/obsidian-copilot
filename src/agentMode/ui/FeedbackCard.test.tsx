import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FeedbackCard, findFeedbackCardIndex } from "./FeedbackCard";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import type { AgentChatMessage } from "@/agentMode/session/types";

const OPEN_OFFER: FeedbackOffer = {
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

function message(id: string, sender: "user" | "AI"): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const TRANSCRIPT = [
  message("user-1", "user"),
  message("ai-1", "AI"),
  message("user-2", "user"),
  message("ai-2a", "AI"),
  message("ai-2b", "AI"),
  message("user-3", "user"),
  message("ai-3", "AI"),
];

function renderCard(offer: FeedbackOffer = OPEN_OFFER) {
  const props = { offer, onReview: jest.fn(), onDismiss: jest.fn(), onTurnOff: jest.fn() };
  render(<FeedbackCard {...props} />);
  return props;
}

jest.mock("@/constants", () => ({ USER_SENDER: "user" }));

describe("FeedbackCard", () => {
  describe("findFeedbackCardIndex()", () => {
    it("places the card after the last reply of the turn that raised it", () => {
      expect(findFeedbackCardIndex(TRANSCRIPT, OPEN_OFFER)).toBe(4);
    });

    it("places the card at the end while the raising turn is still the latest", () => {
      expect(findFeedbackCardIndex(TRANSCRIPT.slice(0, 5), OPEN_OFFER)).toBe(4);
    });

    it("places the card at the end when the raising message is no longer in the transcript", () => {
      expect(
        findFeedbackCardIndex(TRANSCRIPT.slice(0, 2), { ...OPEN_OFFER, afterUserMessageId: null })
      ).toBe(1);
    });

    it("hides the card when there is no offer, it was dismissed, or there are no messages", () => {
      expect(findFeedbackCardIndex(TRANSCRIPT, null)).toBe(-1);
      expect(findFeedbackCardIndex(TRANSCRIPT, { ...OPEN_OFFER, status: "dismissed" })).toBe(-1);
      expect(findFeedbackCardIndex([], OPEN_OFFER)).toBe(-1);
    });
  });

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
});
