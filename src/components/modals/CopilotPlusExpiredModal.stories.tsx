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
    onOpenModelSettings: () => undefined,
    isUsingPlusModels: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotPlusExpiredModalContentProps>;
export default meta;

/** The current default is not a Copilot model; renewal and model settings remain available. */
export const NoWarning: StoryObj<CopilotPlusExpiredModalContentProps> = {};

/** The selected Copilot model is unavailable; model settings provides a separate recovery path. */
export const ModelsWillStopWorking: StoryObj<CopilotPlusExpiredModalContentProps> = {
  args: { isUsingPlusModels: true },
};
