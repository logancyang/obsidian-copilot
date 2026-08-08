import { PromptSuggestionPlaceholder } from "@/components/chat-components/PromptSuggestionPlaceholder";
import { INSERT_TEXT_WITH_PILLS_COMMAND } from "@/components/chat-components/utils/lexicalTextUtils";
import { TYPEWRITER_TIMINGS } from "@/components/chat-components/utils/promptTypewriter";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act, render, screen } from "@testing-library/react";
import {
  COMMAND_PRIORITY_EDITOR,
  KEY_TAB_COMMAND,
  type LexicalEditor as LexicalEditorType,
} from "lexical";
import React from "react";

// One prompt: the pool shuffle is then an identity, so the assertions read
// against a known string. Rotation across a pool is covered in
// promptTypewriter.test.ts.
const PROMPT = "hi there";
const PROMPTS = Object.freeze([PROMPT]);
const DESCRIPTION_ID = "suggestion-description";
const { typeMs, deleteMs, holdMs, gapMs } = TYPEWRITER_TIMINGS;

let editor: LexicalEditorType;
/** Text the placeholder asked the editor to commit, in dispatch order. */
let insertedText: string[];

function EditorCapture(): null {
  [editor] = useLexicalComposerContext();
  return null;
}

function renderPlaceholder() {
  const result = render(
    <LexicalComposer
      initialConfig={{
        namespace: "prompt-suggestion-test",
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <EditorCapture />
      <PromptSuggestionPlaceholder prompts={PROMPTS} descriptionId={DESCRIPTION_ID} />
    </LexicalComposer>
  );
  // Stand in for TextInsertionPlugin, which owns this command in the real
  // composer, so the test asserts what the placeholder asked for.
  editor.registerCommand(
    INSERT_TEXT_WITH_PILLS_COMMAND,
    (payload: { text: string }) => {
      insertedText.push(payload.text);
      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
  return result;
}

/**
 * Run the clock forward. Exactly one frame timer is ever pending, and the frame
 * it renders only schedules its successor once React flushes — so every call
 * advances at most one frame. Pass a phase's own delay to stay on the machine's
 * real clock rather than skipping ahead of it.
 */
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** Type the prompt out character by character, landing on the held frame. */
function typeOutPrompt() {
  for (let i = 0; i < PROMPT.length; i++) advance(typeMs);
}

function pressTab(modifiers: Partial<KeyboardEvent> = {}): boolean {
  const event = { preventDefault: jest.fn(), ...modifiers } as unknown as KeyboardEvent;
  let handled = false;
  act(() => {
    handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
  });
  return handled;
}

describe("PromptSuggestionPlaceholder", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    insertedText = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("types the prompt in one character at a time", () => {
    renderPlaceholder();
    expect(screen.queryByText(/./)).toBeNull();

    advance(typeMs);
    expect(screen.getByText("h")).toBeTruthy();

    advance(typeMs);
    advance(typeMs);
    advance(typeMs);
    expect(screen.getByText("hi t")).toBeTruthy();
  });

  it("keeps the finished prompt on screen before clearing it a character at a time", () => {
    renderPlaceholder();
    typeOutPrompt();
    expect(screen.getByText(PROMPT)).toBeTruthy();

    // Still whole a tick short of the hold expiring.
    advance(holdMs - 1);
    expect(screen.getByText(PROMPT)).toBeTruthy();

    advance(1);
    expect(screen.getByText("hi ther")).toBeTruthy();
    advance(deleteMs);
    expect(screen.getByText("hi the")).toBeTruthy();
  });

  it("surfaces the Tab affordance only while a prompt is fully shown", () => {
    renderPlaceholder();
    advance(typeMs);
    expect(screen.queryByText("⇥ Tab")).toBeNull();

    for (let i = 1; i < PROMPT.length; i++) advance(typeMs);
    expect(screen.getByText("⇥ Tab")).toBeTruthy();

    advance(holdMs);
    expect(screen.queryByText("⇥ Tab")).toBeNull();
  });

  it("describes the whole prompt and its shortcut from the first typed character", () => {
    const { container } = renderPlaceholder();
    const description = () => container.querySelector(`#${DESCRIPTION_ID}`)?.textContent;

    advance(typeMs);
    expect(screen.getByText("h")).toBeTruthy();
    // Announced before Tab is ever pressed, and naming what Tab commits —
    // not the single character currently on screen.
    expect(description()).toBe(`Suggested prompt: ${PROMPT}. Press Tab to insert it.`);

    // Stable while the animation runs: a per-character description would make
    // the composer unusable with a screen reader.
    advance(typeMs);
    advance(typeMs);
    expect(description()).toBe(`Suggested prompt: ${PROMPT}. Press Tab to insert it.`);
  });

  it("describes nothing in the beat between two prompts, where Tab is unbound", () => {
    const { container } = renderPlaceholder();
    typeOutPrompt();
    advance(holdMs);
    for (let i = 1; i < PROMPT.length; i++) advance(deleteMs);

    expect(container.querySelector(`#${DESCRIPTION_ID}`)?.textContent).toBe("");
  });

  it("commits the whole prompt on Tab even when only part of it is typed", () => {
    renderPlaceholder();
    advance(typeMs);

    expect(pressTab()).toBe(true);
    expect(insertedText).toEqual([PROMPT]);
  });

  it("commits the prompt on Tab while it is holding", () => {
    renderPlaceholder();
    typeOutPrompt();

    expect(pressTab()).toBe(true);
    expect(insertedText).toEqual([PROMPT]);
  });

  it("leaves Tab alone in the beat between two prompts", () => {
    renderPlaceholder();
    typeOutPrompt();
    // Hold expires, then every character is cleared: nothing is on screen.
    advance(holdMs);
    for (let i = 1; i < PROMPT.length; i++) advance(deleteMs);
    expect(screen.queryByText(/./)).toBeNull();

    expect(pressTab()).toBe(false);
    expect(insertedText).toEqual([]);

    // The gap elapses, the next prompt starts typing, and Tab works again.
    advance(gapMs);
    advance(typeMs);
    expect(pressTab()).toBe(true);
    expect(insertedText).toEqual([PROMPT]);
  });

  it("ignores Tab pressed with a modifier, leaving Shift+Tab to the mode cycler", () => {
    renderPlaceholder();
    typeOutPrompt();

    expect(pressTab({ shiftKey: true })).toBe(false);
    expect(pressTab({ metaKey: true })).toBe(false);
    expect(pressTab({ ctrlKey: true })).toBe(false);
    expect(pressTab({ altKey: true })).toBe(false);
    expect(insertedText).toEqual([]);
  });

  it("stops its timers when unmounted mid-animation", () => {
    const { unmount } = renderPlaceholder();
    advance(typeMs);
    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
