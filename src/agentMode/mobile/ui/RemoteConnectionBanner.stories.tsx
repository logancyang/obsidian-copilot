import type { Meta, StoryObj } from "@/lib/story";
import {
  RemoteConnectionBanner,
  type RemoteConnectionBannerProps,
} from "@/agentMode/mobile/ui/RemoteConnectionBanner";

const meta = {
  title: "Agent Mode/Remote/Connection Banner",
  component: RemoteConnectionBanner,
  args: { desktopName: "Studio Mac", onRetry: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RemoteConnectionBannerProps>;
export default meta;

export const Reconnecting: StoryObj<RemoteConnectionBannerProps> = {
  args: { banner: "reconnecting" },
};

export const DesktopOffline: StoryObj<RemoteConnectionBannerProps> = {
  args: { banner: "offline" },
};

export const TailscaleUnreachable: StoryObj<RemoteConnectionBannerProps> = {
  args: { banner: "unreachable" },
};
