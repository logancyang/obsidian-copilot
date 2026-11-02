import {
  NavigatorBlockedNotice,
  NavigatorUpsellContent,
  type NavigatorUpsellContentProps,
} from "@/agentMode/navigator/ui/NavigatorUpsell";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "Agent Mode/Navigator Upsell",
  component: NavigatorUpsellContent,
  args: { onUpgrade: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<NavigatorUpsellContentProps>;
export default meta;

export const UpgradeDialog: StoryObj<NavigatorUpsellContentProps> = {};

export const BlockedView: StoryObj<NavigatorUpsellContentProps> = {
  render: () => <NavigatorBlockedNotice />,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
};
