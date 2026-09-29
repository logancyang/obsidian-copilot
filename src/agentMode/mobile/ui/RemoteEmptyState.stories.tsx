import type { Meta, StoryObj } from "@/lib/story";
import {
  RemoteEmptyState,
  type RemoteEmptyStateProps,
} from "@/agentMode/mobile/ui/RemoteEmptyState";

const meta = {
  title: "Agent Mode/Remote/Empty State",
  component: RemoteEmptyState,
  args: { desktopName: "Studio Mac", creating: false, onStart: () => {} },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RemoteEmptyStateProps>;
export default meta;

export const NoSessions: StoryObj<RemoteEmptyStateProps> = {};

export const Starting: StoryObj<RemoteEmptyStateProps> = { args: { creating: true } };
