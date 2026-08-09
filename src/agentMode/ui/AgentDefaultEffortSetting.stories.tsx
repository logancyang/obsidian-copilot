import {
  AgentDefaultEffortSetting,
  type AgentDefaultEffortSettingProps,
} from "@/agentMode/ui/AgentDefaultEffortSetting";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Default Effort Setting",
  component: AgentDefaultEffortSetting,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentDefaultEffortSettingProps>;
export default meta;

export const Supported: StoryObj<AgentDefaultEffortSettingProps> = {
  args: {
    value: null,
    options: [
      { value: null, label: "Agent default" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    disabledLabel: "Not supported",
    onChange: () => undefined,
  },
};

export const Unsupported: StoryObj<AgentDefaultEffortSettingProps> = {
  args: {
    value: null,
    options: [],
    disabledLabel: "Not supported",
    onChange: () => undefined,
  },
};
