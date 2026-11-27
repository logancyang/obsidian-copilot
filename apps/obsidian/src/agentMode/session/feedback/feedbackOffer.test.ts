import { SEND_FEEDBACK_TOOL_NAME } from "@/agentMode/session/copilotMcpServer";
import { AgentReportedError, AuthRequiredError } from "@/agentMode/session/errors";
import { fakeChat, fakeChatView, FAKE_EVIDENCE } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
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

const ISSUE_4483 = "https://github.com/logancyang/obsidian-copilot/issues/4483";
const ISSUE_1026 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/1026";

function toolCall(
  id: string,
  status: "failed" | "in_progress" | "completed",
  copilotToolName?: string
): AgentMessagePart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status,
    ...(copilotToolName ? { copilotTools: { calls: [{ name: copilotToolName, args: {} }] } } : {}),
  };
}

function failedTool(id: string, copilotToolName?: string): AgentMessagePart {
  return toolCall(id, "failed", copilotToolName);
}

const RUNS_NO_SCRIPT = (): boolean => false;

const OWN_REPORT = toolCall("own-report", "in_progress", SEND_FEEDBACK_TOOL_NAME);

function transcriptEndingWith(...parts: AgentMessagePart[]): AgentChatMessage[] {
  return [
    ...TRANSCRIPT,
    {
      id: "a2",
      sender: AI_SENDER,
      message: "",
      isVisible: true,
      timestamp: null,
      parts: [...parts, OWN_REPORT],
    },
  ];
}

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
          title: "Chat reply failed on claude",
          whatHappened: "rate limited",
          userSaid: "",
          repro: "",
        },
      };

      expect(formatFeedbackNote(failed)).toBe(
        [
          "Chat reply failed on claude",
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

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("shown");

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

      offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT);

      expect(chat.readChatState(FEEDBACK_OFFER)?.afterUserMessageId).toBeNull();
    });

    it.each([
      ["a backend's own tool, such as its shell", failedTool("shell")],
      ["a connected service's tool", failedTool("linear_save_issue", "linear_save_issue")],
    ])(`${ISSUE_4483} shows no card when the latest failed tool is %s`, (_label, failure) => {
      const chat = fakeChat(fakeChatView(transcriptEndingWith(failure)));

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("not_copilot");
      expect(chat.readChatState(FEEDBACK_OFFER)).toBeNull();
    });

    it(`${ISSUE_1026} shows no card when a shell command failed and the only Copilot tool after it is the agent's own still-running send_feedback call`, () => {
      const chat = fakeChat(fakeChatView(transcriptEndingWith(failedTool("shell"))));

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("not_copilot");
    });

    it(`${ISSUE_1026} opens a card when the latest failed tool is a shell command running one of Copilot's own scripts`, () => {
      const script = { ...failedTool("web-search"), input: { command: "sh web-search.sh" } };
      const runsWebSearch = (input: unknown) =>
        (input as { command?: string } | undefined)?.command === "sh web-search.sh";
      const chat = fakeChat(fakeChatView(transcriptEndingWith(failedTool("shell"), script)));

      expect(offerFeedback(chat, DRAFT, runsWebSearch)).toBe("shown");
    });

    it(`${ISSUE_4483} opens a card when the latest failed tool is one Copilot runs, even after another party's tool failed`, () => {
      const chat = fakeChat(
        fakeChatView(
          transcriptEndingWith(failedTool("shell"), failedTool("read", "excalidraw_read"))
        )
      );

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("shown");
    });

    it.each([
      ["still running, such as a hung call", "in_progress"],
      ["finished without an error, such as one returning bad output", "completed"],
    ] as const)(
      `${ISSUE_4483} opens a card when a Copilot tool ran after another party's tool failed and is %s`,
      (_label, status) => {
        const chat = fakeChat(
          fakeChatView(
            transcriptEndingWith(
              failedTool("computer-use"),
              toolCall("cli", status, "obsidian_cli")
            )
          )
        );

        expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("shown");
      }
    );

    it(`${ISSUE_4483} shows no card when another party's tool failed after the last Copilot tool ran`, () => {
      const chat = fakeChat(
        fakeChatView(
          transcriptEndingWith(toolCall("cli", "completed", "obsidian_cli"), failedTool("shell"))
        )
      );

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("not_copilot");
    });

    it(`${ISSUE_4483} ignores tool failures from before the latest user message`, () => {
      const chat = fakeChat(
        fakeChatView([
          { ...TRANSCRIPT[0], parts: [] },
          { ...TRANSCRIPT[1], parts: [failedTool("shell")] },
          TRANSCRIPT[2],
        ])
      );

      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("shown");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 refuses a second card in the same chat whether the first is open, dismissed or sent", () => {
      const chat = fakeChat();
      offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT);
      const first = chat.readChatState(FEEDBACK_OFFER);

      expect(offerFeedback(chat, { ...DRAFT, title: "Another problem" }, RUNS_NO_SCRIPT)).toBe(
        "already_offered"
      );
      chat.updateChatState(FEEDBACK_OFFER, dismissFeedbackOffer);
      expect(offerFeedback(chat, DRAFT, RUNS_NO_SCRIPT)).toBe("already_offered");
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
            title: "Chat reply failed on claude",
            whatHappened: "model not supported: gemini-4",
            userSaid: "",
            repro: "",
          },
          evidence: FAKE_EVIDENCE,
          afterUserMessageId: "u2",
          status: "open",
        });
      });

      it(`${ISSUE_4483} shows no card when the agent reports the failure of its own run`, () => {
        expect(fail(null, new AgentReportedError("Prompt is too long"))).toBeNull();
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
