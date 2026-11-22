import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";
import { QuickChatPromptSelect } from "./QuickChatPromptSelect";

type Props = ComponentProps<typeof QuickChatPromptSelect>;

const meta = {
  title: "Chat/Quick Chat Prompt Select",
  component: QuickChatPromptSelect,
  args: {
    prompts: [{ title: "Writing coach" }, { title: "Code review" }],
    value: "",
    onChange: () => undefined,
  },
} satisfies Meta<Props>;
export default meta;

export const VaultInstructions: StoryObj<Props> = {};
export const SelectedPrompt: StoryObj<Props> = { args: { value: "Writing coach" } };
export const NoSavedPrompts: StoryObj<Props> = { args: { prompts: [] } };
