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
      enabledAgents: ["claude"],
    },
  ],
  agents: [
    { id: "claude", displayName: "Claude", Icon: Bot },
    { id: "codex", displayName: "Codex", Icon: Bot },
    { id: "opencode", displayName: "OpenCode", Icon: Bot },
  ],
  availableAgents: ["claude", "codex"],
  pendingSkills: [],
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
  args: { ...args, preferences: { [args.skills[0].name]: { disabled: true } } },
};
export const NoAgents: StoryObj<BuiltinSkillsTableProps> = {
  args: { ...args, availableAgents: [] },
};
export const NameCollision: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    unavailableReasons: {
      [args.skills[0].name]:
        "A skill with this name already exists in Your Skills. Your file is kept unchanged.",
    },
  },
};
export const CleanupError: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    error:
      "Your preference is saved, but some skill files could not be removed. Check folder permissions and try again.",
  },
};

export const UpdatingOneSkill: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    pendingSkills: [args.skills[0].name],
    skills: [
      ...args.skills,
      { ...args.skills[0], name: "copilot-read-pdf", description: "Read a PDF document." },
    ],
  },
};
