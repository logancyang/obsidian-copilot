import type { Meta, StoryObj } from "@/lib/story";
import { AgentVoiceSettings, type AgentVoiceSettingsProps } from "./AgentVoiceSettings";

const meta = {
  title: "Settings/Agent Voice",
  component: AgentVoiceSettings,
  args: {
    enabled: true,
    serverUrl: "https://voice.example.com",
    credential: "demo-credential-value",
    onEnabledChange: () => undefined,
    onServerUrlChange: () => undefined,
    onCredentialChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentVoiceSettingsProps>;
export default meta;

export const Configured: StoryObj<AgentVoiceSettingsProps> = {};

export const Disabled: StoryObj<AgentVoiceSettingsProps> = {
  args: { enabled: false },
};

export const EnabledWithoutCredential: StoryObj<AgentVoiceSettingsProps> = {
  args: { serverUrl: "", credential: "" },
};
