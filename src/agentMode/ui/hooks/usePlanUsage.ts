import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { SessionState } from "@/agentMode/protocol/state";
import type { PlanUsage } from "@/agentMode/session/planUsage";
import type { SessionId } from "@/agentMode/session/types";
import { useSessionSlice } from "@/agentMode/ui/hooks/useSessionSlice";

const selectPlanUsage = (session: SessionState) => session.planUsage;

export function usePlanUsage(client: SessionClient, sessionId: SessionId): PlanUsage | null {
  return useSessionSlice(client, sessionId, selectPlanUsage) ?? null;
}
