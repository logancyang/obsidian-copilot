import { EVENT_NAMES } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import { useChatInput } from "@/context/ChatInputContext";
import { useContext, useEffect } from "react";

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
    if (bus?.consumePendingVisible()) focusInput();
    return () => eventTarget?.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleVisible);
  }, [eventTarget, focusInput]);
}
