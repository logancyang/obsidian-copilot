import type { Meta, StoryObj } from "@/lib/story";
import {
  AgentsSettingsView,
  type AgentRowActions,
  type AgentsSettingsViewProps,
} from "./AgentsSettingsView";
import type { AgentEditorProps } from "./AgentEditor";
import type { AgentRowItem } from "./AgentRow";

const noop = () => {};

const actions: AgentRowActions = {
  onSelect: noop,
  onEdit: noop,
  onOpenFolder: noop,
  onOpenMemory: noop,
  onClearMemory: noop,
  onDelete: noop,
};

const AGENTS: AgentRowItem[] = [
  {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor. Cuts fluff, argues for the reader.",
    icon: "🪶",
    backendLabel: "Claude Code",
    memoryLabel: "2.6 KB",
  },
  {
    slug: "vancat",
    name: "Vancat",
    description: "Blunt systems reviewer. Asks what breaks at ten times the load.",
    icon: "🐈",
    backendLabel: null,
    memoryLabel: "412 B",
  },
  {
    slug: "atlas",
    name: "Atlas",
    description: "Research librarian with no memory, for one-off lookups.",
    icon: "A",
    backendLabel: "Codex",
    memoryLabel: null,
  },
];

const BACKEND_OPTIONS = [
  { label: "Session default", value: "" },
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
  { label: "OpenCode", value: "opencode" },
];

const MODEL_OPTIONS = [
  { label: "Backend default", value: "" },
  { label: "Sonnet", value: "sonnet" },
  { label: "Opus", value: "opus" },
];

function editor(overrides: Partial<AgentEditorProps>): AgentEditorProps {
  return {
    mode: "create",
    slug: null,
    draft: {
      name: "",
      icon: "",
      description: "",
      instructions: "",
      backendId: "",
      modelId: "",
      memoryEnabled: true,
    },
    onChange: noop,
    backendOptions: BACKEND_OPTIONS,
    modelOptions: MODEL_OPTIONS,
    error: null,
    saving: false,
    onSave: noop,
    onCancel: noop,
    ...overrides,
  };
}

const base: AgentsSettingsViewProps = {
  agentsFolder: "copilot/agents",
  agents: [],
  searchValue: "",
  onSearchChange: noop,
  onNewAgent: noop,
  actions,
  selectedSlug: null,
  editor: null,
};

const meta = {
  title: "Agents/Agents Settings",
  component: AgentsSettingsView,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentsSettingsViewProps>;
export default meta;

export const Empty: StoryObj<AgentsSettingsViewProps> = {
  name: "Empty — no agents yet",
  args: base,
};

export const WithAgents: StoryObj<AgentsSettingsViewProps> = {
  name: "List with agents",
  args: { ...base, agents: AGENTS },
};

export const EditorCreate: StoryObj<AgentsSettingsViewProps> = {
  name: "Editor — creating the first agent",
  args: {
    ...base,
    editor: editor({
      draft: {
        name: "Jennifer",
        icon: "🪶",
        description: "Skeptical editor. Cuts fluff, argues for the reader.",
        instructions:
          "You are Jennifer, a developmental editor. You care about the reader more than the author. Push back on vague claims. Prefer short sentences.",
        backendId: "claude",
        modelId: "sonnet",
        memoryEnabled: true,
      },
    }),
  },
};

export const EditorEdit: StoryObj<AgentsSettingsViewProps> = {
  name: "Editor — editing an existing agent",
  args: {
    ...base,
    agents: AGENTS,
    selectedSlug: "vancat",
    editor: editor({
      mode: "edit",
      slug: "vancat",
      draft: {
        name: "Vancat",
        icon: "🐈",
        description: "Blunt systems reviewer. Asks what breaks at ten times the load.",
        instructions: "You are Vancat. Find the failure mode first, then say what you would do.",
        backendId: "",
        modelId: "",
        memoryEnabled: true,
      },
      onOpenInEditor: noop,
    }),
  },
};

export const EditorRejectedIcon: StoryObj<AgentsSettingsViewProps> = {
  name: "Editor — rejected icon",
  args: {
    ...base,
    agents: AGENTS,
    editor: editor({
      draft: {
        name: "Jennifer",
        icon: "ab",
        description: "",
        instructions: "",
        backendId: "",
        modelId: "",
        memoryEnabled: true,
      },
      error: "The icon must be a single emoji or letter.",
    }),
  },
};

export const SearchNoMatches: StoryObj<AgentsSettingsViewProps> = {
  name: "Search with no matches",
  args: { ...base, agents: AGENTS, searchValue: "librarian who edits" },
};
