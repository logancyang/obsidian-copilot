import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { useSessionSelector } from "@/agentMode/protocol/react";
import type { HostState, SessionState } from "@/agentMode/protocol/state";
import type { SessionId } from "@/agentMode/session/types";
import { useEffect } from "react";

// Reads part of one session's replica and keeps that session subscribed while the caller is
// mounted. It is null until the session's snapshot arrives. `select` must be stable across
// renders.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export function useSessionSlice<T>(
  client: SessionClient,
  sessionId: SessionId,
  select: (session: SessionState, host: HostState) => T,
  eq?: (a: T, b: T) => boolean
): T | null {
  useEffect(() => client.watchSession(sessionId), [client, sessionId]);
  return useSessionSelector(client, sessionId, select, eq);
}
