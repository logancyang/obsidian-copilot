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
 * What a user sees right after a license key validates, including OpenArtifacts publishing. The single offer is the
 * whole state — there is no loading, error, or partially-applied variant, since
 * the modal only reports the choice and `applyLicenseSettings` owns the outcome.
 * Check at 300–600 px: explicit default-setting choices wrap above the shorter
 * benefits line, and declining leaves the current defaults untouched.
 */
export const Default: StoryObj<CopilotPlusWelcomeModalContentProps> = {};
