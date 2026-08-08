import { ModePicker } from "@/components/ui/ModePicker";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModePickerProps = ComponentProps<typeof ModePicker>;

const meta = {
  title: "UI/Mode Picker",
  component: ModePicker,
  args: {
    override: {
      options: [
        { label: "Default", value: "default" },
        { label: "Plan", value: "plan" },
        { label: "Auto", value: "auto" },
      ],
      value: "auto",
      onChange: () => undefined,
    },
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModePickerProps>;
export default meta;

/** Auto copy stays permission-neutral because each backend maps it differently. */
export const Auto: StoryObj<ModePickerProps> = {};
