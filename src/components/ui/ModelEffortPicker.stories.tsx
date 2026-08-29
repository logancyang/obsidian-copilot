import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelEffortPickerProps = ComponentProps<typeof ModelEffortPicker>;

const meta = {
  title: "UI/Model Effort Picker",
  component: ModelEffortPicker,
  args: {
    override: {
      models: [
        {
          name: "copilot-plus/copilot-plus-flash",
          provider: "agent",
          displayName: "Copilot Plus Flash",
          enabled: true,
          _group: "opencode",
          _backendId: "opencode",
          _disabledReason: "Loading…",
          _subtitle: "The default model: fastest responses and the most quota.",
        },
        {
          name: "openai/gpt-5",
          provider: "agent",
          displayName: "GPT-5",
          enabled: true,
          _group: "opencode",
          _backendId: "opencode",
        },
      ],
      value: "opencode:copilot-plus/copilot-plus-flash|agent",
      effortOptionsByModelKey: {},
      commitSelection: () => undefined,
    },
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModelEffortPickerProps>;
export default meta;

/** The saved Plus model is registering while another ready OpenCode model remains selectable. */
export const SavedModelLoading: StoryObj<ModelEffortPickerProps> = {};

/** The live catalog could not be reached; alternatives remain selectable. */
export const SavedModelUnavailable: StoryObj<ModelEffortPickerProps> = {
  args: {
    override: {
      ...meta.args.override,
      models: meta.args.override.models.map((model) =>
        model.name === "copilot-plus/copilot-plus-flash"
          ? { ...model, _disabledReason: "Unavailable" }
          : model
      ),
    },
  },
};
