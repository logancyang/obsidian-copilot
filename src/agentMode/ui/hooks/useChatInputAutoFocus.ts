import { EVENT_NAMES } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import { useChatInput } from "@/context/ChatInputContext";
import { useContext, useEffect } from "react";

/**
 * Move keyboard focus to the chat composer whenever the agent view is opened or
 * becomes the active pane — mirroring the main chat (Chat.tsx).
 *
 * The plugin signals visibility on the view's eventTarget: `activateAgentView`
 * latches it via `queueVisible` (so a view opened while still mounting drains it
 * here on attach), and `active-leaf-change` dispatches CHAT_IS_VISIBLE directly
 * (the view is already mounted). `focusInput` is itself latched in
 * ChatInputContext, so it resolves once the editor registers its handler — no
 * timer or mount-timing guess anywhere. Focus is event-driven, not fired on a
 * raw mount, so passively restoring a background agent pane on startup doesn't
 * steal focus from the editor.
 */
export function useChatInputAutoFocus(): void {
  const { focusInput } = useChatInput();
  const eventTarget = useContext(EventTargetContext);

  useEffect(() => {
    const bus = eventTarget instanceof ChatViewEventTarget ? eventTarget : null;
    const handleVisible = () => {
      bus?.consumePendingVisible();
      focusInput();
    };
    eventTarget?.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleVisible);
    // Drain a visibility queued before this listener attached (view opened while
    // still mounting), mirroring the insert-text latch.
    if (bus?.consumePendingVisible()) focusInput();
    return () => eventTarget?.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleVisible);
  }, [eventTarget, focusInput]);
}
