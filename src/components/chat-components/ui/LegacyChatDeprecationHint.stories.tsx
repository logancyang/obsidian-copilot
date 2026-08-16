import {
  LegacyChatDeprecationHint,
  type LegacyChatDeprecationHintProps,
} from "@/components/chat-components/ui/LegacyChatDeprecationHint";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Chat/Legacy Chat Deprecation Hint",
  component: LegacyChatDeprecationHint,
  args: { onOpenAgent: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<LegacyChatDeprecationHintProps>;
export default meta;

export const Default: StoryObj<LegacyChatDeprecationHintProps> = {};
