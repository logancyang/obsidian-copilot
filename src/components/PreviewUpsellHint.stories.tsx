import type { Meta, StoryObj } from "@/lib/story";
import { PreviewHint } from "./PreviewUpsellHint";

const meta = {
  title: "UI/Preview Upsell Hint",
  component: PreviewHint,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<object>;
export default meta;

export const WithoutAccess: StoryObj<object> = {};
