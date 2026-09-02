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

/** Simplified Chinese copy follows the active Obsidian locale. */
export const SimplifiedChinese: StoryObj<ModePickerProps> = {
  args: {
    override: {
      options: [
        { label: "安全", value: "default" },
        { label: "计划", value: "plan" },
        { label: "自动", value: "auto" },
      ],
      value: "auto",
      onChange: () => undefined,
      copy: {
        label: "模式",
        tooltip: "运行模式",
        display: {
          default: { label: "安全", description: "每次编辑前都请求批准。" },
          plan: { label: "计划", description: "先起草计划，得到你的批准后再编辑。" },
          auto: {
            label: "自动",
            description: "使用智能体的自动权限来运行工具和编辑内容。",
          },
        },
      },
    },
  },
};
