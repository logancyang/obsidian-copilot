import type { Meta, StoryObj } from "@/lib/story";
import {
  CopilotPlusWelcomeModalContent,
  type CopilotPlusWelcomeModalContentProps,
} from "./CopilotPlusWelcomeModal";

const meta = {
  title: "Modals/Copilot Welcome",
  component: CopilotPlusWelcomeModalContent,
  args: {
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotPlusWelcomeModalContentProps>;
export default meta;

export const Default: StoryObj<CopilotPlusWelcomeModalContentProps> = {};
