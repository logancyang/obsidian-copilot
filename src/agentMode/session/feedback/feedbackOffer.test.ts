import { formatChatReportNote, formatFeedbackNote, type FeedbackOffer } from "./feedbackOffer";

function offer(userSaid: string): FeedbackOffer {
  return {
    trigger: "agent",
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/762 gives a failed reply's card only its title, the error and the evidence line", () => {
      const failed: FeedbackOffer = {
        ...offer(""),
        trigger: "turn_error",
        draft: {
          title: "Agent Chat reply failed on claude",
          whatHappened: "rate limited",
          userSaid: "",
          repro: "",
        },
      };

      expect(formatFeedbackNote(failed)).toBe(
        [
          "Agent Chat reply failed on claude",
          "",
          "Error: rate limited",
          "",
          "Evidence: backend claude · model unknown · session ses_42 · 2026-10-08T22:13:52.669Z",
        ].join("\n")
      );
    });
  });

  describe("formatChatReportNote()", () => {
    it("leaves the first line blank for the user's own description and ends with the chat's evidence line", () => {
      expect(formatChatReportNote(offer("").evidence)).toBe(
        "\n\nEvidence: backend claude · model unknown · session ses_42 · 2026-10-08T22:13:52.669Z"
      );
    });
  });
});
