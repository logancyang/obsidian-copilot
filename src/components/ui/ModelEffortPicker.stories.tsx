import { AgentPickerList, ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";
import type { AgentPickerRow } from "@/components/ui/ModelEffortPicker";
import React, { type ComponentProps } from "react";

type Props = ComponentProps<typeof ModelEffortPicker>;
const meta = {
  title: "UI/Model Effort Picker",
  component: ModelEffortPicker,
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const ConcreteEffort = {
  args: {
    override: {
      models: [{ name: "example", displayName: "Example model", provider: "agent", enabled: true }],
      value: "example|agent",
      effort: {
        value: "low",
        options: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        onChange: () => undefined,
      },
      effortOptionsByModelKey: {
        "example|agent": [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
      commitSelection: () => undefined,
    },
  },
} satisfies StoryObj<Props>;
export const HighEffort: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      effort: { ...ConcreteEffort.args.override.effort, value: "high" },
    },
  },
};
export const NoEffortControl: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      effort: undefined,
      effortOptionsByModelKey: { "example|agent": [] },
    },
  },
};

export const Unlicensed: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      models: [
        {
          name: "copilot-plus-flash",
          displayName: "Copilot Plus Flash",
          provider: "copilot-plus",
          enabled: true,
          _needsLicense: true,
          _disabledReason: "Copilot license required",
          _subtitle: "The default model: fastest responses and the most quota.",
        },
        ...ConcreteEffort.args.override.models,
        { name: "local", displayName: "Local model", provider: "ollama", enabled: true },
      ],
    },
  },
};

export const CustomEndpointLabels: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      models: [
        {
          name: "d5df8680-65f4-4c4b-81d2-7797550f47fe/auto",
          displayName: "Office LiteLLM proxy/auto",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
        {
          name: "8a1c33e2-0f5b-4a7e-9d61-2b7f4c0e9a10/auto",
          displayName: "Home lab vLLM server running on the basement workstation/auto",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
        {
          name: "copilot-plus/copilot-plus-flash",
          displayName: "copilot-plus/copilot-plus-flash",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
      ],
      value: "d5df8680-65f4-4c4b-81d2-7797550f47fe/auto|agent",
      effort: undefined,
      effortOptionsByModelKey: {},
    },
  },
};
const COPILOT_ROW: AgentPickerRow = {
  slug: "copilot",
  name: "Copilot",
  icon: "✦",
  description: "Your vault instructions, no persona, no memory.",
  modelKey: null,
  effort: null,
};

const JENNIFER_ROW: AgentPickerRow = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  modelKey: "example|agent",
  effort: "high",
};

const VANCAT_ROW: AgentPickerRow = {
  slug: "vancat",
  name: "Vancat",
  icon: "🐈",
  description: "Research partner. Finds the paper you half-remember.",
  modelKey: null,
  effort: null,
};

const agentOverride = (rows: AgentPickerRow[], selectedSlug: string): Props["override"] => ({
  ...ConcreteEffort.args.override,
  models: [
    {
      name: "example",
      displayName: "Sonnet 4.6",
      provider: "agent",
      enabled: true,
      _group: "Claude Code",
      _backendId: "claude",
      _subtitle: "Balanced speed and depth for everyday work.",
    },
    {
      name: "other",
      displayName: "Opus 4.4",
      provider: "agent",
      enabled: true,
      _group: "Claude Code",
      _backendId: "claude",
    },
  ],
  effortOptionsByModelKey: {
    ...ConcreteEffort.args.override.effortOptionsByModelKey,
    "other|agent": ConcreteEffort.args.override.effortOptionsByModelKey["example|agent"],
  },
  agents: { rows, selectedSlug, onSelect: () => undefined, onOpen: () => undefined },
});

export const AgentSelectRow: StoryObj<Props> = {
  args: { defaultOpen: true, override: agentOverride([COPILOT_ROW], "copilot") },
};

export const AgentSelectRowPinnedAgent: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    override: {
      ...agentOverride(
        [COPILOT_ROW, { ...JENNIFER_ROW, modelKey: "other|agent" }, VANCAT_ROW],
        "jennifer"
      ),
      value: "other|agent",
      effort: { ...ConcreteEffort.args.override.effort, value: "high" },
    },
  },
};

const teamOf = (count: number): AgentPickerRow[] =>
  Array.from({ length: count }, (_, i) => ({
    slug: `agent-${i + 1}`,
    name: `Agent ${i + 1}`,
    icon: "🟦",
    description: `Stands in for the ${i + 1}th agent a real team would hold.`,
    modelKey: null,
    effort: null,
  }));

export const AgentListTwoAgents: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW]}
      selectedSlug="copilot"
      highlightSlug="jennifer"
      onPick={() => undefined}
    />
  ),
};

export const AgentListSixAgents: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW, ...teamOf(3)]}
      selectedSlug="vancat"
      onPick={() => undefined}
    />
  ),
};

export const AgentListHighlightOnSelected: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW]}
      selectedSlug="jennifer"
      highlightSlug="jennifer"
      onPick={() => undefined}
    />
  ),
};

export const AgentListSearchable: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW, ...teamOf(9)]}
      selectedSlug="copilot"
      search={{ query: "", onChange: () => undefined }}
      onPick={() => undefined}
    />
  ),
};

export const AgentListSearchFiltered: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[JENNIFER_ROW]}
      selectedSlug="copilot"
      highlightSlug="jennifer"
      search={{ query: "jen", onChange: () => undefined }}
      onPick={() => undefined}
    />
  ),
};

export const AgentListNoMatch: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[]}
      selectedSlug="copilot"
      search={{ query: "zzz", onChange: () => undefined }}
      onPick={() => undefined}
    />
  ),
};

export const AgentListLongDescription: StoryObj<Props> = {
  render: () => (
    <AgentPickerList
      rows={[
        COPILOT_ROW,
        {
          ...JENNIFER_ROW,
          slug: "the-long-winded-developmental-editor",
          name: "The Long-Winded Developmental Editor",
          icon: "📝",
          description:
            "Reads every draft twice, argues for the reader over the author, and will not let a vague claim past without a citation, a cut, or a fight.",
        },
      ]}
      selectedSlug="the-long-winded-developmental-editor"
      onPick={() => undefined}
    />
  ),
};
