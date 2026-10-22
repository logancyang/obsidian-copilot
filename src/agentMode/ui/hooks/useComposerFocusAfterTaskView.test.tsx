import { useComposerFocusAfterTaskView } from "@/agentMode/ui/hooks/useComposerFocusAfterTaskView";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { act, renderHook } from "@testing-library/react";
import React, { useEffect } from "react";

function FocusRegistrar({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  useEffect(() => {
    registerFocusHandler(onFocus);
  }, [registerFocusHandler, onFocus]);
  return null;
}

function renderWithComposer(focus: () => void) {
  return renderHook(({ open }: { open: boolean }) => useComposerFocusAfterTaskView(open), {
    initialProps: { open: true },
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ChatInputProvider>
        <FocusRegistrar onFocus={focus} />
        {children}
      </ChatInputProvider>
    ),
  });
}

describe("useComposerFocusAfterTaskView", () => {
  describe("useComposerFocusAfterTaskView()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/749 focuses the composer once the task view the user left with Back has closed", () => {
      const focus = jest.fn();
      const { result, rerender } = renderWithComposer(focus);

      act(() => result.current());
      expect(focus).not.toHaveBeenCalled();
      rerender({ open: false });

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("leaves focus alone when the task view closes without Back, such as on a chat tab switch", () => {
      const focus = jest.fn();
      const { rerender } = renderWithComposer(focus);

      rerender({ open: false });
      rerender({ open: true });
      rerender({ open: false });

      expect(focus).not.toHaveBeenCalled();
    });
  });
});
