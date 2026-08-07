import {
  ClaudeAutoModePermissionSetting,
  type ClaudeAutoModePermissionSettingProps,
} from "@/agentMode/backends/claude/ui/ClaudeAutoModePermissionSetting";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Claude Auto Mode Permission Setting",
  component: ClaudeAutoModePermissionSetting,
  args: {
    value: "auto",
    onChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ClaudeAutoModePermissionSettingProps>;
export default meta;

/** The default uses Claude's classifier and can still ask before risky actions. */
export const Auto: StoryObj<ClaudeAutoModePermissionSettingProps> = {};

export const AcceptEdits: StoryObj<ClaudeAutoModePermissionSettingProps> = {
  args: { value: "acceptEdits" },
};

export const BypassPermissions: StoryObj<ClaudeAutoModePermissionSettingProps> = {
  args: { value: "bypassPermissions" },
};
