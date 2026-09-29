import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useEffect, useRef, useState } from "react";

export function useSessionUsage(backend: AgentChatBackend): SessionUsage | null {
  const [usage, setUsage] = useState<SessionUsage | null>(() => backend.getSessionUsage());

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = () => setUsage(backend.getSessionUsage());
    sync();
    return backend.subscribe(() => {
      if (!isMountedRef.current) return;
      sync();
    });
  }, [backend]);

  return usage;
}
