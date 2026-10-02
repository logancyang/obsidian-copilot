import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { PreviewBadge, type PreviewBadgeProps } from "./AgentHomePreviewBadge";

const meta = {
  title: "Agent/Agent Home Preview Badge",
  component: PreviewBadge,
  args: { onOpen: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<PreviewBadgeProps>;
export default meta;

function HomeFrame(props: Partial<PreviewBadgeProps>): React.ReactElement {
  return (
    <div className="tw-relative tw-flex tw-h-96 tw-flex-col tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
      <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-4">
        <div className="tw-text-ui-larger tw-text-normal">What shall we dig into?</div>
        <div className="tw-h-20 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border" />
      </div>
      <PreviewBadge {...(props as PreviewBadgeProps)} />
    </div>
  );
}

export const OnAgentHome: StoryObj<PreviewBadgeProps> = {
  render: HomeFrame,
};
