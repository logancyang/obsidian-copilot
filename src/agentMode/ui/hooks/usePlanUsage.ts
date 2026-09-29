import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { PlanUsage } from "@/agentMode/session/planUsage";
import { useEffect, useRef, useState } from "react";

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
