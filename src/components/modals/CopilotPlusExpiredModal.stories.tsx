import type { Meta, StoryObj } from "@/lib/story";
import {
  CopilotPlusExpiredModalContent,
  type CopilotPlusExpiredModalContentProps,
} from "./CopilotPlusExpiredModal";

const meta = {
  title: "Modals/Copilot Expired",
  component: CopilotPlusExpiredModalContent,
  args: {
    onCancel: () => undefined,
    isUsingPlusModels: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotPlusExpiredModalContentProps>;
export default meta;

/** The lapsed user is on their own model: renewing is a choice, so no warning. */
export const NoWarning: StoryObj<CopilotPlusExpiredModalContentProps> = {};

/** The lapsed user's default chat model is a Copilot one, so it is about to stop answering. */
export const ModelsWillStopWorking: StoryObj<CopilotPlusExpiredModalContentProps> = {
  args: { isUsingPlusModels: true },
};
