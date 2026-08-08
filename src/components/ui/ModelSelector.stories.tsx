import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

/**
 * The Copilot rows as `lockedCopilotEntries` builds them, written out as
 * fixtures so the story stays deterministic if the lineup or the default-on set
 * changes. `_needsLicense` is what draws the lock and suppresses the right-side
 * label; `_disabledReason` is what disables the row.
 */
const LOCKED_COPILOT_ROWS: ModelSelectorEntry[] = [
  {
    name: "copilot-plus-flash",
    provider: "copilot-plus",
    displayName: "Copilot Plus Flash",
    enabled: true,
    _group: "OpenCode",
    _backendId: "opencode",
    _needsLicense: true,
    _disabledReason: "Copilot license required",
    _subtitle: "The default model: fastest responses and the most quota.",
  },
  {
    name: "deepseek-v4-pro",
    provider: "copilot-plus",
    displayName: "DeepSeek V4 Pro",
    enabled: true,
    _group: "OpenCode",
    _backendId: "opencode",
    _needsLicense: true,
    _disabledReason: "Copilot license required",
    _subtitle: "A top-tier model for the hardest reasoning and agentic tasks.",
  },
  {
    name: "glm-5.2",
    provider: "copilot-plus",
    displayName: "GLM-5.2",
    enabled: true,
    _group: "OpenCode",
    _backendId: "opencode",
    _needsLicense: true,
    _disabledReason: "Copilot license required",
    _subtitle: "A long-horizon frontier open model that beats some of the best closed models.",
  },
];

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
 * No license: the Copilot lineup leads the section, greyed and non-selectable,
 * each row marked by a lock whose hover reads "Copilot license required" and
 * subtitled with what the model is for. The rows carry no right-side label —
 * the lock says it once instead of repeating the sentence down the group. Open
 * the picker, then hover a lock: the row is pointer-disabled but the lock is
 * not, which is what keeps the reason reachable here.
 */
export const Unlicensed: StoryObj<ModelSelectorProps> = {
  args: {
    models: [...LOCKED_COPILOT_ROWS, ...OWN_MODELS],
  },
};

/** The case a brand-new user hits: nothing of their own, so the offer is all there is. */
export const UnlicensedWithNoModelsOfTheirOwn: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: LOCKED_COPILOT_ROWS,
  },
};
