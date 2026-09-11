import type {
  AgentVoiceControls as VoiceControls,
  AgentVoiceRuntimeState,
} from "@/agentMode/session/voiceTypes";
import { VoiceModeBar } from "@/agentMode/ui/VoiceModeBar";
import { Button } from "@/components/ui/button";
import { Mic } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

export interface AgentVoiceControlsProps {
  controls: VoiceControls | null;
  state: AgentVoiceRuntimeState;
}

/** Composer controls observe the conversation owner; remounting them never closes its call. */
export function AgentVoiceControls({ controls, state }: AgentVoiceControlsProps) {
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.session !== "active") return;
    const ownerWindow = rootRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const timer = ownerWindow.setInterval(() => setNow(Date.now()), 1000);
    return () => ownerWindow.clearInterval(timer);
  }, [state.session]);
  if (!controls) return null;
  const start = async () => {
    setError(null);
    try {
      const outcome = await controls.start();
      if (!outcome.started) setError(outcome.reason);
    } catch {
      setError("Voice could not connect. Try again or keep typing.");
    }
  };
  const end = async () => {
    try {
      await controls.end();
    } catch {
      setError("Voice could not confirm closure. Keep typing while the call expires.");
    }
  };
  // A disconnected transport is already off, but its failure still needs a
  // visible explanation and a restart action. See VOICE_CHAT_DEMO_DESIGN.md,
  // "Mode and control behavior".
  const visibleError =
    error ??
    (state.session === "off" && state.errorCode
      ? "Voice disconnected. Start voice again, or keep typing."
      : null);
  return (
    <div ref={rootRef} className="tw-px-2 tw-pb-2">
      {state.session === "off" ? (
        <Button variant="ghost" size="sm" onClick={() => void start()}>
          <Mic className="tw-size-4" />
          Start voice
        </Button>
      ) : (
        <VoiceModeBar
          state={state}
          elapsedSeconds={
            state.startedAtMs ? Math.max(0, Math.floor((now - state.startedAtMs) / 1000)) : 0
          }
          onMutedChange={(muted) => controls.setMuted(muted)}
          onEnd={() => void end()}
        />
      )}
      {visibleError && (
        <p role="alert" className="tw-m-0 tw-text-ui-small tw-text-normal">
          {visibleError}
        </p>
      )}
    </div>
  );
}
