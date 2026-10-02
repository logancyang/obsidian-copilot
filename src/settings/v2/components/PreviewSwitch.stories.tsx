import type { Meta, StoryObj } from "@/lib/story";
import { PreviewChannelSwitch, type PreviewChannelSwitchProps } from "./PreviewSwitch";

const meta = {
  title: "Settings/Preview Switch",
  component: PreviewChannelSwitch,
  args: {
    previewVersion: null,
    previewEnabled: false,
    onSelect: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PreviewChannelSwitchProps>;
export default meta;

export const Official: StoryObj<PreviewChannelSwitchProps> = {};

export const Preview: StoryObj<PreviewChannelSwitchProps> = {
  args: { previewEnabled: true },
};

export const PreviewAheadOfOfficial: StoryObj<PreviewChannelSwitchProps> = {
  args: { previewEnabled: true, previewVersion: "4.0.14" },
};
