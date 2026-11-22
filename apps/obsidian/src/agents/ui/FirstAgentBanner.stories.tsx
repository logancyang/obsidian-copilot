import { FirstAgentBannerView, type FirstAgentBannerViewProps } from "@/agents/ui/FirstAgentBanner";
import { THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Copilot Teammates/First Agent Banner",
  component: FirstAgentBannerView,
  args: {
    faces: THREE_AGENTS.map((agent) => agent.faceSrc),
    onCreate: () => {},
    onDismiss: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FirstAgentBannerViewProps>;
export default meta;

export const Default: StoryObj<FirstAgentBannerViewProps> = {};

export const FacesLoadingOrFailed: StoryObj<FirstAgentBannerViewProps> = {
  args: { faces: [] },
};
