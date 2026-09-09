import type { Meta, StoryObj } from "@/lib/story";
import { Bot } from "lucide-react";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

const noop = () => {};
const args: BuiltinSkillsTableProps = {
  skills: [
    {
      name: "copilot-youtube-transcript",
      description: "Get a YouTube video transcript.",
      content: "# YouTube transcript\n\nRetrieve the transcript for a supplied video URL.",
      enabled: true,
      enabledAgents: ["claude"],
    },
  ],
  agents: [
    { id: "claude", displayName: "Claude", Icon: Bot },
    { id: "codex", displayName: "Codex", Icon: Bot },
    { id: "opencode", displayName: "OpenCode", Icon: Bot },
  ],
  availableAgents: ["claude", "codex"],
  pending: false,
  onToggleSkill: noop,
  onToggleAgent: noop,
};
const meta = {
  title: "Skills/Built-in Skills",
  component: BuiltinSkillsTable,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<BuiltinSkillsTableProps>;
export default meta;
export const AgentPreferences: StoryObj<BuiltinSkillsTableProps> = {
  name: "Agent preferences with flush-left heading",
  args,
};
export const DisabledSkill: StoryObj<BuiltinSkillsTableProps> = {
  name: "Disabled skill with visible badge",
  args: { ...args, skills: [{ ...args.skills[0], enabled: false }] },
};
export const NoAgents: StoryObj<BuiltinSkillsTableProps> = {
  args: { ...args, availableAgents: [] },
};
export const FeatureUnavailable: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    skills: [
      {
        ...args.skills[0],
        name: "miyo-search",
        unavailableReason: "Enable the Miyo search skill in Miyo settings to use this skill.",
      },
    ],
  },
};
export const CleanupError: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    error:
      "Your preference is saved, but some skill files could not be removed. Check folder permissions and try again.",
  },
};
