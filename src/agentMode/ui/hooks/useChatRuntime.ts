import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { selectChatRuntime, type ChatRuntime } from "@/agentMode/protocol/selectors";
import type { HostState, SessionState } from "@/agentMode/protocol/state";
import type { SessionId } from "@/agentMode/session/types";
import { useSessionSlice } from "@/agentMode/ui/hooks/useSessionSlice";
import { useCallback } from "react";

export function useChatRuntime(client: SessionClient, sessionId: SessionId): ChatRuntime | null {
  const select = useCallback(
    (session: SessionState, host: HostState) => selectChatRuntime(host, session, sessionId),
    [sessionId]
  );
  return useSessionSlice(client, sessionId, select);
}
