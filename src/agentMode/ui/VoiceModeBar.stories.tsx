import { VoiceModeBar, type VoiceModeBarProps } from "@/agentMode/ui/VoiceModeBar";
import type { Meta, StoryObj } from "@/lib/story";

const state: VoiceModeBarProps["state"] = {
  session: "active",
  inputMuted: false,
  inputCommandPending: false,
  playbackActive: false,
  usage: null,
  secondsRemainingWarning: null,
  errorCode: null,
  queuedFollowUps: [],
};
const meta = {
  title: "Agent/Voice call",
  component: VoiceModeBar,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { state, elapsedSeconds: 84, onMutedChange: () => {}, onEnd: () => {} },
} satisfies Meta<VoiceModeBarProps>;
export default meta;
export const Connected: StoryObj<VoiceModeBarProps> = {};
export const Speaking: StoryObj<VoiceModeBarProps> = {
  args: { state: { ...state, playbackActive: true, outputLevel: 0.15 } },
};
export const Muted: StoryObj<VoiceModeBarProps> = {
  args: { state: { ...state, inputMuted: true } },
};
export const Connecting: StoryObj<VoiceModeBarProps> = {
  args: { state: { ...state, session: "connecting" }, elapsedSeconds: 0 },
};
export const Closing: StoryObj<VoiceModeBarProps> = {
  args: { state: { ...state, session: "closing" } },
};
export const FollowUpQueued: StoryObj<VoiceModeBarProps> = {
  args: {
    state: {
      ...state,
      queuedFollowUps: ["Focus on the customer feedback in the launch review."],
      secondsRemainingWarning: 60,
    },
  },
};
export const Error: StoryObj<VoiceModeBarProps> = {
  args: { state: { ...state, session: "error", errorCode: "transport" } },
};
