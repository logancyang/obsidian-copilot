import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";
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
