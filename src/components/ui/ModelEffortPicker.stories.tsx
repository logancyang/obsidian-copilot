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
