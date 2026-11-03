import type { AgentSession } from "@/agentMode/session/AgentSession";
import { useCallback, useSyncExternalStore } from "react";

export function useSessionLabel(session: AgentSession | null | undefined): string | null {
  const subscribe = useCallback(
    (onChange: () => void) =>
      session?.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: () => {},
        onLabelChanged: onChange,
      }) ?? (() => {}),
    [session]
  );
  return useSyncExternalStore(subscribe, () => session?.getLabel() ?? null);
}
