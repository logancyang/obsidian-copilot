import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { selectChatRuntime, type ChatRuntime } from "@/agentMode/protocol/selectors";
import type { HostState, SessionState } from "@/agentMode/protocol/state";
import { useSessionSelector } from "@/agentMode/protocol/react";
import type { SessionId } from "@/agentMode/session/types";
import { useCallback, useEffect } from "react";

// Reads one session's chat state from the client replica and keeps that session subscribed while
// the caller is mounted. It is null until the session's snapshot arrives.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export function useChatRuntime(client: SessionClient, sessionId: SessionId): ChatRuntime | null {
  useEffect(() => client.watchSession(sessionId), [client, sessionId]);
  const select = useCallback(
    (session: SessionState, host: HostState) => selectChatRuntime(host, session, sessionId),
    [sessionId]
  );
  return useSessionSelector(client, sessionId, select);
}
