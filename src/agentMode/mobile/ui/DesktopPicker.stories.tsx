import type { Meta, StoryObj } from "@/lib/story";
import { DesktopPicker, type DesktopPickerProps } from "@/agentMode/mobile/ui/DesktopPicker";

const meta = {
  title: "Agent Mode/Remote/Desktop Picker",
  component: DesktopPicker,
  args: { onSelect: () => {} },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<DesktopPickerProps>;
export default meta;

export const SeveralDesktops: StoryObj<DesktopPickerProps> = {
  args: {
    desktops: [
      { id: "a", desktopName: "Studio Mac", vaultName: "Work notes", address: "100.64.0.7:52341" },
      {
        id: "b",
        desktopName: "A laptop with a very long machine name",
        vaultName: "Work notes",
        address: "100.64.0.9:50001",
      },
    ],
  },
};

export const NoDesktops: StoryObj<DesktopPickerProps> = { args: { desktops: [] } };
