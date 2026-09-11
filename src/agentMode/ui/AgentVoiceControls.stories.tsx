import {
  AgentVoiceControls,
  type AgentVoiceControlsProps,
} from "@/agentMode/ui/AgentVoiceControls";
import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { ModePicker } from "@/components/ui/ModePicker";
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
  args: {
    state,
    controls,
    children: (startButton) => (
      <div className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-2">
        <p className="tw-m-0 tw-p-2 tw-text-ui-small tw-text-muted">Ask anything</p>
        <div className="tw-flex tw-items-center tw-justify-end tw-gap-1">
          <ModePicker
            override={{
              options: [{ label: "Safe", value: "default" }],
              value: "default",
              onChange: () => {},
            }}
          />
          {startButton}
          <ChatSendButton inputMessage="" imageCount={0} onSend={() => {}} />
        </div>
      </div>
    ),
  },
} satisfies Meta<AgentVoiceControlsProps>;
export default meta;
export const StartVoice: StoryObj<AgentVoiceControlsProps> = {
  render: function VoiceDemo(args) {
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
    return (
      <AgentVoiceControls {...args} controls={demoControls} state={callState}>
        {meta.args.children}
      </AgentVoiceControls>
    );
  },
};
export const Disconnected: StoryObj<AgentVoiceControlsProps> = {
  args: { state: { ...state, errorCode: "transport" } },
};
export const FanoutRefusal: StoryObj<AgentVoiceControlsProps> = { args: { controls } };

export const Connecting: StoryObj<AgentVoiceControlsProps> = {
  args: { state: { ...state, session: "connecting" } },
};
export const Active: StoryObj<AgentVoiceControlsProps> = {
  args: { state: { ...state, session: "active", playbackActive: true } },
};
export const VoiceUnavailable: StoryObj<AgentVoiceControlsProps> = {
  args: { controls: null },
};
