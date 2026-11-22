import { useChatInput } from "@/context/ChatInputContext";
import { useCallback, useEffect, useRef } from "react";

export function useComposerFocusAfterTaskView(taskViewOpen: boolean): () => void {
  const { focusInput } = useChatInput();
  const closedByUser = useRef(false);

  useEffect(() => {
    if (taskViewOpen || !closedByUser.current) return;
    closedByUser.current = false;
    focusInput();
  }, [taskViewOpen, focusInput]);

  return useCallback(() => {
    closedByUser.current = true;
  }, []);
}
