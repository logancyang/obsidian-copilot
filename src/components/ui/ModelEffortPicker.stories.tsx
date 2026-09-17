import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";
import type { AgentPickerRow } from "@/components/ui/ModelEffortPicker";
import type { ComponentProps } from "react";

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

/**
 * Click a locked row or lock, or Tab to the row and press Enter, to open pricing
 * with model-picker-lock attribution. Drafting another model or effort first
 * must not commit that change when pricing opens. Reopen to check the selection.
 */
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

/** The whole popover as Agent Mode renders it: who answers, then what they answer on. */
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

/** A vault with no agents yet: one quiet row the user can ignore until they make one. */
export const AgentSectionCopilotOnly: StoryObj<Props> = {
  args: { defaultOpen: true, override: agentOverride([COPILOT_ROW], "copilot") },
};

/** Every agent on disk, with the description the user picks between them on. */
export const AgentSectionWithAgents: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    override: agentOverride([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW], "copilot"),
  },
};

/**
 * Jennifer pins Opus at high effort, so picking her moved the model and effort
 * sections below onto her pins (`designdocs/CUSTOM_AGENTS.md` §3).
 */
export const AgentSectionPinnedAgent: StoryObj<Props> = {
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

/** A description longer than the popover is wide wraps to two lines, then clamps. */
export const AgentSectionLongDescription: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    override: agentOverride(
      [
        COPILOT_ROW,
        {
          ...JENNIFER_ROW,
          slug: "the-long-winded-developmental-editor",
          name: "The Long-Winded Developmental Editor",
          icon: "📝",
          description:
            "Reads every draft twice, argues for the reader over the author, and will not let a vague claim past without a citation, a cut, or a fight.",
        },
      ],
      "the-long-winded-developmental-editor"
    ),
  },
};
