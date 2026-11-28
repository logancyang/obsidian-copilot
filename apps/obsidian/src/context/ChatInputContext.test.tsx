import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { act, render } from "@testing-library/react";
import React, { useEffect } from "react";

let requestFocus: () => void;

function Composer({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  useEffect(() => {
    registerFocusHandler(onFocus);
    return () => registerFocusHandler(null);
  }, [registerFocusHandler, onFocus]);
  return null;
}

function FocusRequester() {
  requestFocus = useChatInput().focusInput;
  return null;
}

function renderComposer(onFocus: () => void) {
  return render(
    <ChatInputProvider>
      <FocusRequester />
      <Composer onFocus={onFocus} />
    </ChatInputProvider>
  );
}

describe("ChatInputContext", () => {
  describe("focusInput()", () => {
    it("focuses the registered composer", () => {
      const focus = jest.fn();
      renderComposer(focus);

      act(() => requestFocus());

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("waits for the next composer when the previous one was unregistered https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const previous = jest.fn();
      const next = jest.fn();
      const view = renderComposer(previous);
      const requestFromBeforeUnmount = requestFocus;
      view.rerender(
        <ChatInputProvider>
          <FocusRequester />
        </ChatInputProvider>
      );

      act(() => requestFromBeforeUnmount());
      expect(previous).not.toHaveBeenCalled();

      view.rerender(
        <ChatInputProvider>
          <FocusRequester />
          <Composer onFocus={next} />
        </ChatInputProvider>
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(previous).not.toHaveBeenCalled();
    });
  });
});
