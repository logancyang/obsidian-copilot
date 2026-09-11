import type { AgentVoiceControls } from "@/agentMode/session/voiceTypes";
import { logWarn } from "@/logger";
import { useEffect } from "react";

/**
 * End voice when its view or window goes away, independently of composer layout.
 * @param controls The conversation's existing voice owner.
 * @param ownerWindow The window containing the persistent AgentHome root.
 */
export function useAgentVoiceViewLifetime(
  controls: AgentVoiceControls | null,
  ownerWindow: Window | null
): void {
  useEffect(() => {
    if (!controls || !ownerWindow) return;
    let ended = false;
    const end = () => {
      // pagehide may precede React teardown. Both must release the same call once.
      // See VOICE_CHAT_DEMO_DESIGN.md, "Mode and control behavior".
      if (ended) return;
      ended = true;
      void controls
        .end()
        .catch(() => logWarn("[Voice] view closure could not confirm call closure"));
    };
    ownerWindow.addEventListener("pagehide", end);
    return () => {
      ownerWindow.removeEventListener("pagehide", end);
      end();
    };
  }, [controls, ownerWindow]);
}
