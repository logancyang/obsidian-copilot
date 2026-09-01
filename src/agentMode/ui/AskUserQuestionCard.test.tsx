import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import type { AskUserQuestionPrompt, SessionId } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SESSION_ID = "s1" as SessionId;
const REQUEST_ID = "req-1";
const NAVIGATION_QUESTIONS: AskUserQuestionPrompt["questions"] = [
  {
    header: "Scope",
    question: "Which scope?",
    options: [{ label: "Current note" }, { label: "Vault" }],
  },
  {
    header: "Format",
    question: "Which format?",
    options: [{ label: "Summary" }, { label: "Outline" }],
  },
];

function makeRequest(questions: AskUserQuestionPrompt["questions"]): AskUserQuestionPrompt {
  return { sessionId: SESSION_ID, requestId: REQUEST_ID, questions };
}

function renderCard(request: AskUserQuestionPrompt, onResolve: jest.Mock) {
  return render(<AskUserQuestionCard request={request} onResolve={onResolve} />);
}

// The "Other" row's accessible name is its label plus the "Type your own
// response" description (jsdom concatenates them with no separator), so anchor
// on the leading "Other" rather than an exact match. Preset labels here are
// A/B/C, so this can't collide with a preset.
function getOtherControl(role: "radio" | "checkbox"): HTMLElement {
  return screen.getByRole(role, { name: /^other/i });
}

const submitButton = (): HTMLElement => screen.getByRole("button", { name: /submit/i });
const nextButton = (): HTMLElement => screen.getByRole("button", { name: /next/i });
const cancelButton = (): HTMLElement => screen.getByRole("button", { name: /cancel/i });
const otherTextarea = (): HTMLElement => screen.getByPlaceholderText(/type your response/i);

describe("AskUserQuestionCard", () => {
  describe("AskUserQuestionCard()", () => {
    it("fills the available action-rail width", () => {
      const { container } = renderCard(
        makeRequest([{ question: "Continue?", options: [{ label: "Yes" }] }]),
        jest.fn()
      );

      expect(container.firstElementChild?.classList.contains("tw-w-full")).toBe(true);
    });

    it("single-select 'Other' → the trimmed typed text is the answer", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          question: "When do we ship?",
          options: [{ label: "A" }, { label: "B" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(getOtherControl("radio"));
      // Surrounding whitespace proves the answer is trimmed on submit.
      fireEvent.change(otherTextarea(), { target: { value: "  ship it Friday  " } });
      fireEvent.click(submitButton());

      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, {
        "When do we ship?": "ship it Friday",
      });
    });

    it("multi-select presets + 'Other' → checked labels and trimmed text joined with ', '", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          question: "Pick tasks",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(screen.getByRole("checkbox", { name: /^A$/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /^C$/ }));
      fireEvent.click(getOtherControl("checkbox"));
      fireEvent.change(otherTextarea(), { target: { value: "  rollback plan  " } });
      fireEvent.click(submitButton());

      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, {
        "Pick tasks": "A, C, rollback plan",
      });
    });

    it("requires an explicit answer for every question before submitting (https://github.com/Brevilabs/obsidian-copilot-private/issues/182)", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          header: "Deployment",
          question: "Choose deployment",
          options: [{ label: "Production" }, { label: "Staging" }],
        },
        {
          header: "Timing",
          question: "When should we ship?",
          options: [{ label: "Today" }, { label: "Next week" }],
        },
        {
          header: "Checks",
          question: "Which checks are required?",
          multiSelect: true,
          options: [{ label: "Unit tests" }, { label: "End-to-end test" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(screen.getByRole("radio", { name: "Production" }));
      fireEvent.click(screen.getByRole("tab", { name: "Timing" }));
      fireEvent.click(getOtherControl("radio"));
      fireEvent.change(otherTextarea(), { target: { value: "  Friday after QA  " } });
      fireEvent.click(screen.getByRole("tab", { name: "Checks" }));

      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submitButton());
      expect(onResolve).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox", { name: "End-to-end test" }));

      expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole("checkbox", { name: "End-to-end test" }));
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submitButton());
      expect(onResolve).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox", { name: "End-to-end test" }));
      expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submitButton());
      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, {
        "Choose deployment": "Production",
        "When should we ship?": "Friday after QA",
        "Which checks are required?": "End-to-end test",
      });
    });

    it("advances an answered non-final question without resolving the request (https://github.com/Brevilabs/obsidian-copilot-private/issues/117)", () => {
      const onResolve = jest.fn();
      const request = makeRequest(NAVIGATION_QUESTIONS);
      renderCard(request, onResolve);

      expect((nextButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("radio", { name: "Current note" }));
      expect((nextButton() as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(nextButton());

      expect(screen.getByRole("tab", { name: "Format" }).getAttribute("aria-selected")).toBe(
        "true"
      );
      expect(screen.getByText("Which format?")).not.toBeNull();
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
      expect(onResolve).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("radio", { name: "Summary" }));
      expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submitButton());

      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, {
        "Which scope?": "Current note",
        "Which format?": "Summary",
      });
    });

    it("keeps final Submit disabled when a middle question was skipped (https://github.com/Brevilabs/obsidian-copilot-private/issues/117)", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        ...NAVIGATION_QUESTIONS,
        {
          header: "Length",
          question: "How long?",
          options: [{ label: "Short" }, { label: "Detailed" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(screen.getByRole("radio", { name: "Current note" }));
      fireEvent.click(nextButton());
      fireEvent.click(screen.getByRole("tab", { name: "Length" }));
      fireEvent.click(screen.getByRole("radio", { name: "Short" }));

      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submitButton());
      expect(onResolve).not.toHaveBeenCalled();
    });

    it("uses Cmd/Ctrl+Enter for the same Next action shown on a non-final question (https://github.com/Brevilabs/obsidian-copilot-private/issues/117)", () => {
      const onResolve = jest.fn();
      const request = makeRequest(NAVIGATION_QUESTIONS);
      renderCard(request, onResolve);

      fireEvent.click(getOtherControl("radio"));
      fireEvent.change(otherTextarea(), { target: { value: "Open files" } });
      fireEvent.keyDown(otherTextarea(), { key: "Enter", metaKey: true });

      expect(screen.getByText("Which format?")).not.toBeNull();
      expect(onResolve).not.toHaveBeenCalled();
    });

    it("disables Submit while 'Other' is armed with empty text, enabling it once text is typed", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          question: "When do we ship?",
          options: [{ label: "A" }, { label: "B" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(getOtherControl("radio"));
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(otherTextarea(), { target: { value: "x" } });
      expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it("Cancel resolves with an empty answer map", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          question: "When do we ship?",
          options: [{ label: "A" }, { label: "B" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(cancelButton());

      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, {});
    });

    it("regression: single-select preset still resolves with the chosen label", () => {
      const onResolve = jest.fn();
      const request = makeRequest([
        {
          question: "When do we ship?",
          options: [{ label: "A" }, { label: "B" }],
        },
      ]);
      renderCard(request, onResolve);

      fireEvent.click(screen.getByRole("radio", { name: /^A$/ }));
      fireEvent.click(submitButton());

      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, { "When do we ship?": "A" });
    });
  });
});
