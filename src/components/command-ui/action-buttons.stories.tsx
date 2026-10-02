import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";
import { ActionButtons } from "./action-buttons";

type ActionButtonsProps = ComponentProps<typeof ActionButtons>;

const meta = {
  title: "Commands/Result actions",
  component: ActionButtons,
  args: {
    state: "result",
    onRunAgain: () => undefined,
    onInsert: () => undefined,
    onReplace: () => undefined,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ActionButtonsProps>;
export default meta;

export const Result: StoryObj<ActionButtonsProps> = {};
export const RetryAfterFailedRun: StoryObj<ActionButtonsProps> = { args: { state: "idle" } };
export const Generating: StoryObj<ActionButtonsProps> = {
  args: { state: "loading", onStop: () => undefined },
};
