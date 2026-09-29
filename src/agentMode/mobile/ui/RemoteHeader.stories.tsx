import type { Meta, StoryObj } from "@/lib/story";
import { RemoteHeader, type RemoteHeaderProps } from "@/agentMode/mobile/ui/RemoteHeader";

const meta = {
  title: "Agent Mode/Remote/Header",
  component: RemoteHeader,
  args: { desktopName: "Studio Mac", live: true },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RemoteHeaderProps>;
export default meta;

export const Connected: StoryObj<RemoteHeaderProps> = {};

export const NotConnectedWithSeveralDesktops: StoryObj<RemoteHeaderProps> = {
  args: { live: false, onSwitchDesktop: () => {} },
};
