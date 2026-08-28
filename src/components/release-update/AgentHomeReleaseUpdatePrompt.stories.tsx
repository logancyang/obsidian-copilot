import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import {
  AgentHomeReleaseUpdatePrompt,
  type AgentHomeReleaseUpdatePromptProps,
} from "./AgentHomeReleaseUpdatePrompt";

type StoryProps = AgentHomeReleaseUpdatePromptProps;

const meta = {
  title: "Release/Agent Home Update Prototypes",
  component: AgentHomeReleaseUpdatePrompt,
  args: {
    onDismiss: () => undefined,
    onOpen: () => undefined,
    version: "4.0.4",
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<StoryProps>;
export default meta;

function HomeFrame(props: Partial<StoryProps>): React.ReactElement {
  return (
    <div className="tw-relative tw-flex tw-h-96 tw-flex-col tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
      <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-4">
        <div className="tw-text-ui-larger tw-text-normal">What shall we dig into?</div>
        <div className="tw-h-20 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border" />
      </div>
      <div className="tw-h-32 tw-rounded-md tw-border tw-border-solid tw-border-border" />
      <AgentHomeReleaseUpdatePrompt {...(props as StoryProps)} />
    </div>
  );
}

export const LargeBottomBanner: StoryObj<StoryProps> = {
  render: HomeFrame,
};
