import { AuthRequiredError } from "@/agentMode/session/errors";
import { fakeChat, fakeChatView, FAKE_EVIDENCE } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import {
  dismissFeedbackOffer,
  FEEDBACK_OFFER,
  FEEDBACK_OFFER_EXTENSION,
  formatChatReportNote,
  formatFeedbackNote,
  markFeedbackReported,
  offerFeedback,
  type FeedbackOffer,
} from "./feedbackOffer";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: { offerFeedbackCards: true } }),
}));

const TRANSCRIPT: readonly AgentChatMessage[] = [
  { id: "u1", sender: USER_SENDER, message: "hej", isVisible: true, timestamp: null },
  { id: "a1", sender: AI_SENDER, message: "hej", isVisible: true, timestamp: null },
  { id: "u2", sender: USER_SENDER, message: "why?", isVisible: true, timestamp: null },
];

const DRAFT = {
  title: "Replied in Swedish to an English request",
  whatHappened: "The agent answered 'hej'.",
  userSaid: "Why do you switch to a different language?",
  repro: "1. Ask in English.",
};

const REPORT = { reportId: "r1", issueUrl: "https://example.com" };

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

  describe("offerFeedback()", () => {
    it("opens a card with the draft, the chat's evidence and its latest user message as the anchor", () => {
      const chat = fakeChat(fakeChatView(TRANSCRIPT));

      expect(offerFeedback(chat, DRAFT)).toBe("shown");

      expect(chat.readChatState(FEEDBACK_OFFER)).toEqual({
        trigger: "agent",
        draft: DRAFT,
        evidence: FAKE_EVIDENCE,
        afterUserMessageId: "u2",
        status: "open",
      });
    });

    it("anchors to nothing when the chat has no user message yet", () => {
      const chat = fakeChat();

      offerFeedback(chat, DRAFT);

      expect(chat.readChatState(FEEDBACK_OFFER)?.afterUserMessageId).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 refuses a second card in the same chat whether the first is open, dismissed or sent", () => {
      const chat = fakeChat();
      offerFeedback(chat, DRAFT);
      const first = chat.readChatState(FEEDBACK_OFFER);

      expect(offerFeedback(chat, { ...DRAFT, title: "Another problem" })).toBe("already_offered");
      chat.updateChatState(FEEDBACK_OFFER, dismissFeedbackOffer);
      expect(offerFeedback(chat, DRAFT)).toBe("already_offered");
      expect(chat.readChatState(FEEDBACK_OFFER)?.draft).toBe(first?.draft);
    });
  });

  describe("dismissFeedbackOffer()", () => {
    it("marks an open card dismissed", () => {
      expect(dismissFeedbackOffer(offer(""))?.status).toBe("dismissed");
    });

    it("leaves a sent card and a missing card unchanged", () => {
      const sent = markFeedbackReported(offer(""), REPORT);

      expect(dismissFeedbackOffer(sent)).toBe(sent);
      expect(dismissFeedbackOffer(null)).toBeNull();
    });
  });

  describe("markFeedbackReported()", () => {
    it("records the report ID and issue link on an open card", () => {
      expect(markFeedbackReported(offer(""), REPORT)).toMatchObject({
        status: "reported",
        report: REPORT,
      });
    });

    it("ignores a report when no card was offered", () => {
      expect(markFeedbackReported(null, REPORT)).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 keeps a dismissed card dismissed when its upload lands afterwards", () => {
      const dismissed = dismissFeedbackOffer(offer(""));

      expect(markFeedbackReported(dismissed, REPORT)).toBe(dismissed);
    });
  });

  describe("FEEDBACK_OFFER_EXTENSION", () => {
    describe("onTurnFailed()", () => {
      const fail = (
        current: FeedbackOffer | null,
        error: unknown = new Error("model not supported: gemini-4")
      ) =>
        FEEDBACK_OFFER_EXTENSION.onTurnFailed!(current, fakeChatView(TRANSCRIPT), {
          errorText: error instanceof Error ? error.message : String(error),
          error,
        });

      afterEach(() => {
        jest
          .mocked(getSettings)
          .mockReturnValue({ agentMode: { offerFeedbackCards: true } } as never);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/762 opens a card with the error, anchored to the message whose reply failed", () => {
        expect(fail(null)).toEqual({
          trigger: "turn_error",
          draft: {
            title: "Agent Chat reply failed on claude",
            whatHappened: "model not supported: gemini-4",
            userSaid: "",
            repro: "",
          },
          evidence: FAKE_EVIDENCE,
          afterUserMessageId: "u2",
          status: "open",
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/810 shows no card when the backend files the failure as a provider quota", () => {
        const quota = Object.assign(new Error("Internal error: Free usage limit reached."), {
          code: -32603,
          data: { service: "session", errorName: "provider.quota" },
        });

        expect(fail(null, quota)).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/831 shows no card when the reply fails because the user is not signed in", () => {
        expect(fail(null, new AuthRequiredError("You're not signed in to Claude."))).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/762 shows no card when feedback reports are turned off", () => {
        jest
          .mocked(getSettings)
          .mockReturnValue({ agentMode: { offerFeedbackCards: false } } as never);

        expect(fail(null)).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 keeps the chat's one card when a later reply fails", () => {
        const first = dismissFeedbackOffer(offer(""));

        expect(fail(first)).toBe(first);
      });
    });
  });
});
