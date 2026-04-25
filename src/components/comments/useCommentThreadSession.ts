/**
 * useCommentThreadSession - UI binding for a per-comment agent session.
 *
 * Pulls the session for (notePath, commentId) from the
 * `CommentSessionManager` and subscribes to its state updates. The session
 * lives outside the React tree, so closing the popover only unsubscribes —
 * it does NOT abort an in-flight turn.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommentSessionManager } from "@/comments/CommentSessionManager";

interface UseCommentThreadSessionParams {
  sessionManager: CommentSessionManager;
  notePath: string;
  commentId: string;
}

export interface CommentThreadSessionApi {
  isStreaming: boolean;
  streamingText: string;
  sendMessage: (input: string) => Promise<void>;
  stop: () => void;
}

export function useCommentThreadSession(
  params: UseCommentThreadSessionParams
): CommentThreadSessionApi {
  const { sessionManager, notePath, commentId } = params;

  const session = useMemo(
    () => sessionManager.getOrCreate(notePath, commentId),
    [sessionManager, notePath, commentId]
  );

  const [state, setState] = useState(session.getState());

  useEffect(() => {
    return session.subscribe(setState);
  }, [session]);

  const sendMessage = useCallback((input: string) => session.sendMessage(input), [session]);
  const stop = useCallback(() => session.stop(), [session]);

  return {
    isStreaming: state.isStreaming,
    streamingText: state.streamingText,
    sendMessage,
    stop,
  };
}
