import type { AgentVoiceRuntimeState } from "@/agentMode/session/voiceTypes";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import React from "react";

export interface VoiceModeBarProps {
  state: AgentVoiceRuntimeState;
  elapsedSeconds: number;
  onMutedChange: (muted: boolean) => void;
  onEnd: () => void;
}

export function VoiceModeBar({ state, elapsedSeconds, onMutedChange, onEnd }: VoiceModeBarProps) {
  const level = state.outputLevel ?? 0;
  const speaking = level > 0.01;
  const status =
    state.session === "connecting"
      ? "Connecting voice…"
      : state.session === "closing"
        ? "Ending voice…"
        : state.session === "error"
          ? "Voice connection failed"
          : speaking
            ? "Assistant speaking"
            : "Voice connected";
  const elapsed = `${Math.floor(elapsedSeconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(elapsedSeconds % 60)
    .toString()
    .padStart(2, "0")}`;
  return (
    <section
      aria-label="Voice call"
      className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-text-ui-small"
    >
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        {/* Audio amplitude and task progress are independent. See VOICE_CHAT_DEMO_DESIGN.md, "The experience". */}
        <svg
          role="img"
          aria-label={speaking ? "Assistant audio playing" : "Assistant audio quiet"}
          viewBox="0 0 64 24"
          className="tw-h-6 tw-w-16 tw-shrink-0 tw-text-accent motion-reduce:tw-hidden"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((bar) => {
            const height = 2 + Math.min(1, level * 5) * ((bar % 3) + 1) * 6;
            return (
              <rect
                key={bar}
                x={bar * 8 + 1}
                y={(24 - height) / 2}
                width="4"
                height={height}
                rx="2"
                fill="currentColor"
              />
            );
          })}
        </svg>
        <span role="status" className="tw-min-w-24 tw-flex-1">
          {status}
        </span>
        <span className="tw-tabular-nums" aria-label={`Call time ${elapsed}`}>
          {elapsed}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={state.inputMuted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={state.inputMuted}
          disabled={state.session !== "active" || state.inputCommandPending}
          onClick={() => onMutedChange(!state.inputMuted)}
        >
          {state.inputMuted ? <MicOff className="tw-size-4" /> : <Mic className="tw-size-4" />}
          {state.inputCommandPending
            ? "Updating mic…"
            : state.inputMuted
              ? "Mic muted"
              : state.session === "active"
                ? "Mic on"
                : "Mic waiting"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={state.session === "closing"}
          onClick={onEnd}
        >
          End voice
        </Button>
      </div>
      {state.errorCode && (
        <p role="alert" className="tw-m-0 tw-text-normal">
          Voice could not stay connected. End voice and try again, or keep typing.
        </p>
      )}
      {state.secondsRemainingWarning !== null && (
        <p className="tw-m-0 tw-text-normal">Voice ends within a minute.</p>
      )}
      {state.queuedFollowUps.length > 0 && (
        <p className="tw-m-0 tw-text-normal">
          Follow-up queued: {state.queuedFollowUps.join("; ")}. This has not changed the running
          task.
        </p>
      )}
    </section>
  );
}
