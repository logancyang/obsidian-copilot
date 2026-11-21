import { useChatInput } from "@/context/ChatInputContext";
import { useEffect, useRef } from "react";

export function useComposerFocusAfterLandingSend(sessionId: string, isLanding: boolean): void {
  const { focusInput } = useChatInput();
  const previous = useRef({ sessionId, isLanding });

  useEffect(() => {
    const { sessionId: previousSessionId, isLanding: wasLanding } = previous.current;
    previous.current = { sessionId, isLanding };
    // The first send moves the message box from the home layout to the chat layout, which remounts it and drops focus.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/1014
    if (wasLanding && !isLanding && previousSessionId === sessionId) focusInput();
  }, [sessionId, isLanding, focusInput]);
}
