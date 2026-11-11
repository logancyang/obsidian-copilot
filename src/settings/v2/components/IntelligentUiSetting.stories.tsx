import type { Meta, StoryObj } from "@/lib/story";
import { IntelligentUiSetting, type IntelligentUiSettingProps } from "./IntelligentUiSetting";

const meta = {
  title: "Settings/Intelligent UI",
  component: IntelligentUiSetting,
  args: { checked: false, onCheckedChange: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<IntelligentUiSettingProps>;
export default meta;

export const Off: StoryObj<IntelligentUiSettingProps> = {};
export const On: StoryObj<IntelligentUiSettingProps> = { args: { checked: true } };
