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

// More desktops than a phone's height holds: the list scrolls instead of clipping the last ones.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export const ManyDesktops: StoryObj<DesktopPickerProps> = {
  args: {
    desktops: Array.from({ length: 14 }, (_, index) => ({
      id: `desktop-${index}`,
      desktopName: `Desktop ${index + 1}`,
      vaultName: "Work notes",
      address: `100.64.0.${index + 10}:52341`,
    })),
  },
};
