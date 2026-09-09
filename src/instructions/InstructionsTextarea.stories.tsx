import { InstructionsTextarea, type InstructionsTextareaProps } from "./InstructionsTextarea";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Instructions/Instructions Textarea",
  component: InstructionsTextarea,
  args: { value: "", onChange: () => {}, label: "Custom vault instructions" },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<InstructionsTextareaProps>;
export default meta;

/** Empty instructions show a fixed example. */
export const Empty: StoryObj<InstructionsTextareaProps> = {};

/** Saved instructions replace the placeholder. */
export const UserAuthored: StoryObj<InstructionsTextareaProps> = {
  args: {
    value:
      "Put new notes in Inbox/ and link them to a related note.\n\nAsk before editing anything under Archive/.",
  },
};
