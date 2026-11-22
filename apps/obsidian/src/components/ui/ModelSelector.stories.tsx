import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

const LOCKED_COPILOT_ROW: ModelSelectorEntry = {
  name: "copilot-plus-flash",
  provider: "copilot-plus",
  displayName: "Copilot Plus Flash",
  enabled: true,
  _group: "OpenCode",
  _backendId: "opencode",
  _needsLicense: true,
  _disabledReason: "Copilot license required",
  _subtitle: "The default model: fastest responses and the most quota.",
};

const OWN_MODELS: ModelSelectorEntry[] = [
  {
    name: "grok-code",
    provider: "opencode",
    displayName: "opencode/grok-code",
    enabled: true,
    _group: "OpenCode",
    _isFree: true,
  },
  {
    name: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "anthropic/claude-sonnet-4-6",
    enabled: true,
    _group: "OpenCode",
  },
];

const meta = {
  title: "UI/Model Selector",
  component: ModelSelector,
  args: {
    value: "grok-code|opencode",
    onChange: () => undefined,
    models: OWN_MODELS,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModelSelectorProps>;
export default meta;

export const Licensed: StoryObj<ModelSelectorProps> = {};

export const Unlicensed: StoryObj<ModelSelectorProps> = {
  args: {
    models: [LOCKED_COPILOT_ROW, ...OWN_MODELS],
  },
};

export const UnlicensedWithNoModelsOfTheirOwn: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: [LOCKED_COPILOT_ROW],
  },
};

export const CommandNeedsSelection: StoryObj<ModelSelectorProps> = { args: { value: "" } };
