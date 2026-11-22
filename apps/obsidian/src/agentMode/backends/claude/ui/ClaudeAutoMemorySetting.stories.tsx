import {
  ClaudeAutoMemorySetting,
  type ClaudeAutoMemorySettingProps,
} from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Claude Auto Memory Setting",
  component: ClaudeAutoMemorySetting,
  args: {
    value: undefined,
    onChange: () => undefined,
    memoryFolder: "/Users/me/.claude/projects/-Users-me-Notes/memory",
    onOpen: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ClaudeAutoMemorySettingProps>;
export default meta;

export const MemorySaved: StoryObj<ClaudeAutoMemorySettingProps> = {};

export const NoMemory: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { memoryFolder: undefined },
};

export const Off: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { value: false, memoryFolder: undefined },
};
