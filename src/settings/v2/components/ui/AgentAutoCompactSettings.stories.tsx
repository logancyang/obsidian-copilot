import type { Meta, StoryObj } from "@/lib/story";
import {
  AgentAutoCompactSettings,
  type AgentAutoCompactSettingsProps,
} from "./AgentAutoCompactSettings";

const meta = {
  title: "Settings/Agent Auto-Compact",
  component: AgentAutoCompactSettings,
  args: {
    tokens: undefined,
    onChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentAutoCompactSettingsProps>;
export default meta;

export const BackendDefault: StoryObj<AgentAutoCompactSettingsProps> = {};

export const CustomThreshold: StoryObj<AgentAutoCompactSettingsProps> = {
  args: { tokens: 250_000 },
};
