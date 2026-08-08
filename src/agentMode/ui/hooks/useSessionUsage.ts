import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useEffect, useRef, useState } from "react";

/**
 * Reactive snapshot of the backend's latest token-usage report, kept in sync
 * via the same single subscription the rest of the runtime state uses. Returns
 * `null` until the backend has reported usage (fresh / resumed session).
 *
 * Mirrors the subscribe + `isMounted` pattern in
 * {@link useAgentChatRuntimeState}: a fresh initial sync on every `backend`
 * change (the lazy initializer only ran for the first backend) and a mount
 * guard so a notification racing an unmount is a no-op.
 */
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
