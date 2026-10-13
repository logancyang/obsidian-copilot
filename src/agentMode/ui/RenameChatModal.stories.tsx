import { RenameChatForm, type RenameChatFormProps } from "@/agentMode/ui/RenameChatModal";
import type { Meta, StoryObj } from "@/lib/story";

const noop = async () => {};

const meta = {
  title: "Agent Mode/Rename Chat Dialog",
  component: RenameChatForm,
  args: {
    initialTitle: "Plan the fall product launch and collect the open questions",
    onSave: noop,
    onCancel: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<RenameChatFormProps>;
export default meta;

export const CurrentTitle: StoryObj<RenameChatFormProps> = {};

export const BlankTitle: StoryObj<RenameChatFormProps> = {
  args: { initialTitle: "" },
};
