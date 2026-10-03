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
  onOpen: noop,
  onOpenFolder: noop,
  onDelete: noop,
};

function portrait(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="26" r="11" fill="#ffffffcc"/><ellipse cx="32" cy="58" rx="20" ry="16" fill="#ffffffcc"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const JENNIFER_PORTRAIT = portrait("#5b3a7a", "#b48ad8");

const AGENTS: AgentRowItem[] = [
  {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor. Cuts fluff, argues for the reader.",
    avatarSrc: JENNIFER_PORTRAIT,
    backendLabel: "Claude Code",
    cloudEgress: false,
    memoryLabel: "2.6 KB",
  },
  {
    slug: "vancat",
    name: "Vancat",
    description: "Blunt systems reviewer. Asks what breaks at ten times the load.",
    avatarSrc: null,
    backendLabel: null,
    cloudEgress: false,
    memoryLabel: "412 B",
  },
  {
    slug: "atlas",
    name: "Atlas",
    description: "Research librarian with no memory, for one-off lookups.",
    avatarSrc: null,
    backendLabel: "Codex",
    cloudEgress: false,
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

const EFFORT_OPTIONS = [
  { label: "Model default", value: "" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

function editor(overrides: Partial<AgentEditorProps>): AgentEditorProps {
  return {
    mode: "create",
    slug: null,
    draft: {
      name: "",
      description: "",
      instructions: "",
      backendId: "",
      modelId: "",
      effort: "",
      memoryEnabled: true,
      avatarSrc: null,
    },
    onChange: noop,
    onPickAvatar: noop,
    onRemoveAvatar: noop,
    backendOptions: BACKEND_OPTIONS,
    modelOptions: MODEL_OPTIONS,
    effortOptions: EFFORT_OPTIONS,
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
        description: "Skeptical editor. Cuts fluff, argues for the reader.",
        instructions:
          "You are Jennifer, a developmental editor. You care about the reader more than the author. Push back on vague claims. Prefer short sentences.",
        backendId: "claude",
        modelId: "sonnet",
        effort: "low",
        memoryEnabled: true,
        avatarSrc: null,
      },
    }),
  },
};

export const EditorEdit: StoryObj<AgentsSettingsViewProps> = {
  name: "Editor — editing an existing agent",
  args: {
    ...base,
    agents: AGENTS,
    editor: editor({
      mode: "edit",
      slug: "vancat",
      draft: {
        name: "Vancat",
        description: "Blunt systems reviewer. Asks what breaks at ten times the load.",
        instructions: "You are Vancat. Find the failure mode first, then say what you would do.",
        backendId: "",
        modelId: "",
        effort: "",
        memoryEnabled: true,
        avatarSrc: null,
      },
      onOpenInEditor: noop,
      memory: {
        sizeLabel: "412 B",
        onOpenMemory: noop,
        onOpenTodaysNotes: noop,
        onConsolidate: noop,
        onClear: noop,
      },
      onDelete: noop,
    }),
  },
};

export const EditorWithImage: StoryObj<AgentsSettingsViewProps> = {
  name: "Editor — agent with an uploaded image",
  args: {
    ...base,
    agents: AGENTS,
    editor: editor({
      mode: "edit",
      slug: "jennifer",
      draft: {
        name: "Jennifer",
        description: "Skeptical editor. Cuts fluff, argues for the reader.",
        instructions: "You are Jennifer, a developmental editor.",
        backendId: "claude",
        modelId: "sonnet",
        effort: "",
        memoryEnabled: true,
        avatarSrc: JENNIFER_PORTRAIT,
      },
      onOpenInEditor: noop,
      memory: {
        sizeLabel: "2.6 KB",
        onOpenMemory: noop,
        onOpenTodaysNotes: noop,
        onConsolidate: noop,
        onClear: noop,
      },
      onDelete: noop,
    }),
  },
};

export const SelfHostCloudPin: StoryObj<AgentsSettingsViewProps> = {
  name: "List with a cloud-pinned agent in Self-Host Mode",
  args: {
    ...base,
    agents: AGENTS.map((agent) =>
      agent.backendLabel === null ? agent : { ...agent, cloudEgress: true }
    ),
  },
};

export const SearchNoMatches: StoryObj<AgentsSettingsViewProps> = {
  name: "Search with no matches",
  args: { ...base, agents: AGENTS, searchValue: "librarian who edits" },
};
