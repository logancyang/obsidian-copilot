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
    value: undefined,
    onChange: () => undefined,
    memory: { onByDefault: true, folders: [VAULT_MEMORY], folderSetInClaude: false },
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
      onByDefault: true,
      folders: [VAULT_MEMORY, PROJECT_MEMORY],
      folderSetInClaude: false,
    },
  },
};

export const NothingSaved: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { memory: { onByDefault: true, folders: [], folderSetInClaude: false } },
};

export const FolderSetInClaude: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: {
    memory: {
      onByDefault: true,
      folders: ["/Users/me/claude-memory"],
      folderSetInClaude: true,
    },
  },
};

export const Off: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { value: false },
};

export const OffInClaudeCode: StoryObj<ClaudeAutoMemorySettingProps> = {
  args: { memory: { onByDefault: false, folders: [], folderSetInClaude: false } },
};
