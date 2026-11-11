import {
  ClaudeAutoMemorySetting,
  type ClaudeAutoMemorySettingProps,
} from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import type { Meta, StoryObj } from "@/lib/story";

const VAULT_MEMORY = "/Users/me/.claude/projects/-Users-me-Notes/memory";
const PROJECT_MEMORY = "/Users/me/.claude/projects/-Users-me-Notes-Projects-Research/memory";

const meta = {
  title: "Agent Mode/Claude Auto Memory Setting",
  component: ClaudeAutoMemorySetting,
  args: {
    enabled: true,
    onEnabledChange: () => undefined,
    memory: { turnedOffInClaude: false, folders: [VAULT_MEMORY], sharedWithOtherProjects: false },
    onOpenFolder: () => undefined,
    onClear: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ClaudeAutoMemorySettingProps>;
export default meta;

export const On: StoryObj<ClaudeAutoMemorySettingProps> = {};

export const ProjectChats: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: {
    memory: {
      turnedOffInClaude: false,
      folders: [VAULT_MEMORY, PROJECT_MEMORY],
      sharedWithOtherProjects: false,
    },
  },
};

export const NothingSaved: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { memory: { turnedOffInClaude: false, folders: [], sharedWithOtherProjects: false } },
};

export const SharedFolder: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: {
    memory: {
      turnedOffInClaude: false,
      folders: ["/Users/me/claude-memory"],
      sharedWithOtherProjects: true,
    },
  },
};

export const TurnedOffInClaude: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: {
    memory: { turnedOffInClaude: true, folders: [VAULT_MEMORY], sharedWithOtherProjects: false },
  },
};

export const Off: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { enabled: false },
};
