import type { Meta, StoryObj } from "@/lib/story";
import {
  RemoteConnectionScreen,
  type RemoteConnectionScreenProps,
} from "@/agentMode/mobile/ui/RemoteConnectionScreen";

const meta = {
  title: "Agent Mode/Remote/Connection Screen",
  component: RemoteConnectionScreen,
  args: { desktopName: "Studio Mac", onRetry: () => {} },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RemoteConnectionScreenProps>;
export default meta;

export const Connecting: StoryObj<RemoteConnectionScreenProps> = {
  args: { screen: { kind: "connecting" } },
};

export const LoadingSessions: StoryObj<RemoteConnectionScreenProps> = {
  args: { screen: { kind: "syncing" } },
};

export const TailscaleUnreachable: StoryObj<RemoteConnectionScreenProps> = {
  args: { screen: { kind: "unreachable" } },
};

export const DesktopOffline: StoryObj<RemoteConnectionScreenProps> = {
  args: { screen: { kind: "offline" }, onSwitchDesktop: () => {} },
};

export const VersionMismatch: StoryObj<RemoteConnectionScreenProps> = {
  args: {
    screen: {
      kind: "version_mismatch",
      local: { app: "4.0.12", protocol: 1 },
      remote: { app: "4.1.0", protocol: 2 },
    },
  },
};

export const PhoneRevoked: StoryObj<RemoteConnectionScreenProps> = {
  args: { screen: { kind: "denied" } },
};
