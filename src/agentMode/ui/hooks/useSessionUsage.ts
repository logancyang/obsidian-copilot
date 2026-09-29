import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { SessionState } from "@/agentMode/protocol/state";
import type { SessionId, SessionUsage } from "@/agentMode/session/types";
import { useSessionSlice } from "@/agentMode/ui/hooks/useSessionSlice";

const selectUsage = (session: SessionState) => session.usage;

export function useSessionUsage(client: SessionClient, sessionId: SessionId): SessionUsage | null {
  return useSessionSlice(client, sessionId, selectUsage) ?? null;
}
