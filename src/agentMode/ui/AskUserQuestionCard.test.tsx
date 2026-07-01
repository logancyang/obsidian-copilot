import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import type { AskUserQuestionPrompt, SessionId } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SESSION_ID = "s1" as SessionId;
const REQUEST_ID = "req-1";

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
const cancelButton = (): HTMLElement => screen.getByRole("button", { name: /cancel/i });
const otherTextarea = (): HTMLElement => screen.getByPlaceholderText(/type your response/i);

describe("AskUserQuestionCard custom 'Other' response", () => {
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
    expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, { "When do we ship?": "ship it Friday" });
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
    expect(onResolve).toHaveBeenCalledWith(REQUEST_ID, { "Pick tasks": "A, C, rollback plan" });
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
