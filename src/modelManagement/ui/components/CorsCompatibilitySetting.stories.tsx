import type { Meta, StoryObj } from "@/lib/story";
import {
  CorsCompatibilitySetting,
  type CorsCompatibilitySettingProps,
} from "./CorsCompatibilitySetting";

const meta = {
  title: "Settings/CORS Compatibility Setting",
  component: CorsCompatibilitySetting,
  args: { checked: false, onCheckedChange: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CorsCompatibilitySettingProps>;
export default meta;

export const Streaming: StoryObj<CorsCompatibilitySettingProps> = {};

export const CorsCompatibilityEnabled: StoryObj<CorsCompatibilitySettingProps> = {
  args: { checked: true },
};
