import type { Meta, StoryObj } from "@/lib/story";
import {
  AgentNotificationSoundSettings,
  type AgentNotificationSoundSettingsProps,
} from "./AgentNotificationSoundSettings";

const meta = {
  title: "Settings/Agent Notification Sound",
  component: AgentNotificationSoundSettings,
  args: {
    enabled: true,
    onEnabledChange: () => undefined,
    onSoundChange: () => undefined,
    soundId: "piano",
    soundOptions: [
      { label: "Piano key", value: "piano" },
      { label: "Marimba", value: "marimba" },
      { label: "Bell", value: "bell" },
      { label: "Doorbell", value: "doorbell" },
    ],
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentNotificationSoundSettingsProps>;
export default meta;

export const SoundOn: StoryObj<AgentNotificationSoundSettingsProps> = {};

export const SoundOff: StoryObj<AgentNotificationSoundSettingsProps> = {
  args: { enabled: false },
};
