import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

/**
 * The Copilot row as `lockedCopilotEntries` builds it, written out as a fixture
 * so the story stays deterministic if the lineup or the default-on set changes.
 * `_needsLicense` draws the lock and makes activation open pricing without
 * selecting the model.
 */
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

/** The models an unlicensed OpenCode user has of their own. */
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

/** A licensed user: their models, nothing locked. Open the picker to see the rows. */
export const Licensed: StoryObj<ModelSelectorProps> = {};

/**
 * No license: the locked row shows its capability blurb and license tooltip.
 * Click the row or the lock, or use arrow keys and Enter/Space, to open pricing
 * with model-picker-lock attribution. The selected model must stay unchanged.
 */
export const Unlicensed: StoryObj<ModelSelectorProps> = {
  args: {
    models: [LOCKED_COPILOT_ROW, ...OWN_MODELS],
  },
};

/** The case a brand-new user hits: nothing of their own, so the offer is all there is. */
export const UnlicensedWithNoModelsOfTheirOwn: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: [LOCKED_COPILOT_ROW],
  },
};
