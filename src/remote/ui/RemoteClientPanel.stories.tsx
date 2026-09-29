import type { Meta, StoryObj } from "@/lib/story";
import { RemoteClientPanel, type RemoteClientPanelProps } from "./RemoteClientPanel";

const meta = {
  title: "Settings/Remote Client Panel",
  component: RemoteClientPanel,
  args: {
    desktops: [],
    onPairFromLink: async () => "Paired with Studio Mac.",
    onTestConnection: async () => "Connected to Studio Mac.",
    onRemove: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<RemoteClientPanelProps>;
export default meta;

export const NoDesktops: StoryObj<RemoteClientPanelProps> = {};

export const PairedDesktops: StoryObj<RemoteClientPanelProps> = {
  args: {
    desktops: [
      { id: "a", desktopName: "Studio Mac", vaultName: "Work notes", address: "100.64.0.7:52341" },
      { id: "b", desktopName: "Laptop", vaultName: "Work notes", address: "100.64.0.9:50001" },
    ],
  },
};

export const PairingFailure: StoryObj<RemoteClientPanelProps> = {
  args: {
    onPairFromLink: async () =>
      "Can't reach your desktop. Check that Tailscale is on for both devices and that Obsidian is open on the desktop.",
  },
};
