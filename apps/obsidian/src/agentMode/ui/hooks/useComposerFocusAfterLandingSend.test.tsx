import { useComposerFocusAfterLandingSend } from "@/agentMode/ui/hooks/useComposerFocusAfterLandingSend";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { renderHook } from "@testing-library/react";
import React, { useEffect } from "react";

function FocusRegistrar({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  useEffect(() => {
    registerFocusHandler(onFocus);
  }, [registerFocusHandler, onFocus]);
  return null;
}

interface LandingProps {
  sessionId: string;
  isLanding: boolean;
}

function renderOnHome(focus: () => void) {
  return renderHook(
    ({ sessionId, isLanding }: LandingProps) =>
      useComposerFocusAfterLandingSend(sessionId, isLanding),
    {
      initialProps: { sessionId: "chat-1", isLanding: true },
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ChatInputProvider>
          <FocusRegistrar onFocus={focus} />
          {children}
        </ChatInputProvider>
      ),
    }
  );
}

describe("useComposerFocusAfterLandingSend", () => {
  describe("useComposerFocusAfterLandingSend()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/1014 focuses the message box once the home turns into its chat after the first send", () => {
      const focus = jest.fn();
      const { rerender } = renderOnHome(focus);

      rerender({ sessionId: "chat-1", isLanding: false });

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("leaves focus alone on mount and while the chat stays on the home", () => {
      const focus = jest.fn();
      const { rerender } = renderOnHome(focus);

      rerender({ sessionId: "chat-1", isLanding: true });

      expect(focus).not.toHaveBeenCalled();
    });

    it("leaves focus alone when the home opens a different chat that already has messages", () => {
      const focus = jest.fn();
      const { rerender } = renderOnHome(focus);

      rerender({ sessionId: "chat-2", isLanding: false });

      expect(focus).not.toHaveBeenCalled();
    });
  });
});
