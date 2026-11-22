import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";
import { ModelSettingsButton } from "./model-settings-button";

type ModelSettingsButtonProps = ComponentProps<typeof ModelSettingsButton>;

const meta = {
  title: "Commands/Default model settings button",
  component: ModelSettingsButton,
  args: { needsModel: false, onClick: () => undefined },
  parameters: { gallery: { host: "popover", layout: "centered" } },
} satisfies Meta<ModelSettingsButtonProps>;
export default meta;

export const ModelSelected: StoryObj<ModelSettingsButtonProps> = {};
export const NeedsModel: StoryObj<ModelSettingsButtonProps> = { args: { needsModel: true } };
