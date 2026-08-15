import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { PlanUsage } from "@/agentMode/session/planUsage";
import { useEffect, useRef, useState } from "react";

/**
 * Reactive snapshot of the backend's latest plan-cap report, kept in sync through the
 * same single subscription the rest of the runtime state uses. Returns `null` until a
 * backend reports caps — a fresh session, a backend with no usage API, or an account
 * whose authentication is not metered by plan caps all look the same here, and all mean
 * the same thing to the UI: render no cap meters.
 *
 * Mirrors {@link useSessionUsage}: a fresh sync on every `backend` change, and a mount
 * guard so a notification racing an unmount is a no-op.
 */
export function usePlanUsage(backend: AgentChatBackend): PlanUsage | null {
  const [planUsage, setPlanUsage] = useState<PlanUsage | null>(() => backend.getPlanUsage());

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = () => setPlanUsage(backend.getPlanUsage());
    sync();
    return backend.subscribe(() => {
      if (!isMountedRef.current) return;
      sync();
    });
  }, [backend]);

  return planUsage;
}
