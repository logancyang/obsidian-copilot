import {
  AgentVoiceControls,
  type AgentVoiceControlsProps,
} from "@/agentMode/ui/AgentVoiceControls";
import React, { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@/lib/story";
const state: AgentVoiceControlsProps["state"] = {
  session: "off",
  inputMuted: false,
  inputCommandPending: false,
  playbackActive: false,
  usage: null,
  secondsRemainingWarning: null,
  errorCode: null,
  queuedFollowUps: [],
};
const controls: NonNullable<AgentVoiceControlsProps["controls"]> = {
  getState: () => state,
  subscribe: () => () => {},
  start: async () => ({ started: false, reason: "Select a single agent before starting voice." }),
  end: async () => {},
  setMuted: () => {},
};
const meta = {
  title: "Agent/Voice composer",
  component: AgentVoiceControls,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { state, controls },
} satisfies Meta<AgentVoiceControlsProps>;
export default meta;
export const StartVoice: StoryObj<AgentVoiceControlsProps> = {
  render: function VoiceDemo() {
    const [callState, setCallState] = useState(state);
    const demoControls = useMemo<NonNullable<AgentVoiceControlsProps["controls"]>>(
      () => ({
        getState: () => callState,
        subscribe: () => () => {},
        start: async () => {
          setCallState({ ...state, session: "active", startedAtMs: Date.now() });
          return { started: true };
        },
        end: async () => setCallState(state),
        setMuted: (inputMuted) => setCallState((current) => ({ ...current, inputMuted })),
      }),
      [callState]
    );
    return <AgentVoiceControls controls={demoControls} state={callState} />;
  },
};
export const Disconnected: StoryObj<AgentVoiceControlsProps> = {
  args: { state: { ...state, errorCode: "transport" } },
};
export const FanoutRefusal: StoryObj<AgentVoiceControlsProps> = { args: { controls } };
