import { formatFeedbackNote, type FeedbackOffer } from "./feedbackOffer";

function offer(userSaid: string): FeedbackOffer {
  return {
    draft: {
      title: "Replied in Swedish to an English request",
      whatHappened: "The agent answered 'hej' instead of English.",
      userSaid,
      repro: "1. Type a garbled 'commit and push'.",
    },
    evidence: {
      backendId: "claude",
      model: null,
      sessionId: "ses_42",
      raisedAt: "2026-10-08T22:13:52.669Z",
    },
    afterUserMessageId: "user-2",
    status: "open",
  };
}

describe("feedbackOffer", () => {
  describe("formatFeedbackNote()", () => {
    it("leads with the title so it becomes the issue title, then each field and the evidence line", () => {
      expect(formatFeedbackNote(offer("Why do you switch languages?"))).toBe(
        [
          "Replied in Swedish to an English request",
          "",
          "What happened: The agent answered 'hej' instead of English.",
          "",
          'What the user said: "Why do you switch languages?"',
          "",
          "Steps to reproduce: 1. Type a garbled 'commit and push'.",
          "",
          "Evidence: backend claude · model unknown · session ses_42 · 2026-10-08T22:13:52.669Z",
        ].join("\n")
      );
    });

    it("says the agent raised it when the user did not comment", () => {
      expect(formatFeedbackNote(offer(""))).toContain(
        "What the user said: The user didn't comment; the agent raised this."
      );
    });
  });
});
