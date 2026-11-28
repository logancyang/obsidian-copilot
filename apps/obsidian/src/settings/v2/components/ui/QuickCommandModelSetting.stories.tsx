import type { Meta, StoryObj } from "@/lib/story";
import {
  QuickCommandModelSetting,
  type QuickCommandModelSettingProps,
} from "./QuickCommandModelSetting";

const meta = {
  title: "Settings/Quick Command model",
  component: QuickCommandModelSetting,
  args: {
    options: [{ label: "Claude Sonnet 4.6 (OpenRouter)", value: "sonnet" }],
    onChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<QuickCommandModelSettingProps>;
export default meta;
export const Configured: StoryObj<QuickCommandModelSettingProps> = { args: { value: "sonnet" } };
export const NeedsSelection: StoryObj<QuickCommandModelSettingProps> = {
  args: { value: undefined },
};
export const NoEnabledModels: StoryObj<QuickCommandModelSettingProps> = {
  args: { value: undefined, options: [] },
};
