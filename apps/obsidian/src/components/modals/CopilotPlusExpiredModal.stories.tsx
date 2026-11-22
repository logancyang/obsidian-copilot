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

export const NoWarning: StoryObj<CopilotPlusExpiredModalContentProps> = {};

export const ModelsWillStopWorking: StoryObj<CopilotPlusExpiredModalContentProps> = {
  args: { isUsingPlusModels: true },
};
