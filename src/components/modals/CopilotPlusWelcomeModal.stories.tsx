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

/**
 * What a user sees right after a license key validates. The single offer is the
 * whole state — there is no loading, error, or partially-applied variant, since
 * the modal only reports the choice and `applyLicenseSettings` owns the outcome.
 * Check it at narrow widths with the gallery's width toolbar: the model name is
 * the one unbreakable token in the sentence.
 */
export const Default: StoryObj<CopilotPlusWelcomeModalContentProps> = {};
