import type { ChainType } from "@/chainType";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";
import { ChatModeSelector } from "./ChatModeSelector";

type ChatModeSelectorProps = ComponentProps<typeof ChatModeSelector>;

const meta = {
  title: "Chat/Quick Chat Mode Selector",
  component: ChatModeSelector,
  args: {
    selectedChain: "llm_chain" as ChainType,
    isPaidUser: true,
    onModeChange: () => undefined,
    onPlusUpsell: () => undefined,
    defaultOpen: true,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ChatModeSelectorProps>;
export default meta;

export const FreeChat: StoryObj<ChatModeSelectorProps> = {};

export const CopilotPlus: StoryObj<ChatModeSelectorProps> = {
  args: { selectedChain: "copilot_plus" as ChainType },
};

export const FreeUserUpsell: StoryObj<ChatModeSelectorProps> = {
  args: { isPaidUser: false },
};
