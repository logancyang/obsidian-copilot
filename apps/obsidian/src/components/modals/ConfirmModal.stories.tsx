import type { Meta, StoryObj } from "@/lib/story";
import { ConfirmModalContent, type ConfirmModalContentProps } from "./ConfirmModal";

const meta = {
  title: "Modals/Confirm",
  component: ConfirmModalContent,
  args: {
    content: `Delete project "Research"? This removes its configuration; your notes stay in the vault.`,
    confirmButtonText: "Delete project",
    cancelButtonText: "Cancel",
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ConfirmModalContentProps>;
export default meta;

export const Default: StoryObj<ConfirmModalContentProps> = {};

export const Destructive: StoryObj<ConfirmModalContentProps> = {
  args: {
    content:
      "Agents lose access to Notion on all your devices, and Copilot signs out of it. You can connect it again anytime.",
    confirmButtonText: "Disconnect",
    confirmButtonVariant: "destructive",
  },
};
