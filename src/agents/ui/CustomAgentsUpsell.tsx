import { ReactModal } from "@/components/modals/ReactModal";
import { SupporterPreviewUpsell } from "@/components/modals/SupporterPreviewUpsell";
import type { ProductUtmMedium } from "@/lib/productLinks";
import type { App } from "obsidian";
import * as React from "react";

export interface UpsellVideo {
  url: string;
  thumbnailUrl: string;
}

export const COPILOT_TEAMMATES_VIDEO: UpsellVideo = {
  url: "https://www.youtube.com/watch?v=Ri4YB0qR-Go",
  thumbnailUrl:
    "https://images.brevilabs.com/newsletters/copilot-plugin/copilot-teammates/teammates-video-play-7008237f.webp",
};

export type CustomAgentsUpsellMedium = Extract<
  ProductUtmMedium,
  "custom_agent_dialog" | "custom_agent_mention"
>;

const TEAMMATES_POINTS = [
  "Correct a teammate or tell it how you like things done, and it remembers next time",
  "@ another teammate for a second opinion or to hand off part of the work",
  "Change how a teammate works by editing its instructions in your vault",
];

interface UpsellVideoThumbnailProps {
  video: UpsellVideo;
}

function UpsellVideoThumbnail({ video }: UpsellVideoThumbnailProps): React.ReactElement | null {
  const [failed, setFailed] = React.useState(false);
  // Offline the thumbnail cannot load and YouTube cannot play, so the video area goes away instead of showing a broken image: https://github.com/Brevilabs/obsidian-copilot-private/issues/979
  if (failed) return null;
  return (
    // Width cap keeps the 16:9 thumbnail under 40vh tall so the footer buttons fit short windows: https://github.com/Brevilabs/obsidian-copilot-private/issues/582
    <a
      aria-label="Watch the video on YouTube"
      className="tw-mx-auto tw-block tw-w-full tw-max-w-[calc(40vh*16/9)] tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border"
      href={video.url}
      rel="noopener"
      target="_blank"
    >
      <img
        alt=""
        className="tw-block tw-h-auto tw-w-full"
        height={720}
        onError={() => setFailed(true)}
        src={video.thumbnailUrl}
        width={1280}
      />
    </a>
  );
}

export interface CustomAgentsUpsellContentProps {
  medium: CustomAgentsUpsellMedium;
  onClose: () => void;
  video?: UpsellVideo | null;
}

export function CustomAgentsUpsellContent({
  medium,
  onClose,
  video = COPILOT_TEAMMATES_VIDEO,
}: CustomAgentsUpsellContentProps): React.ReactElement {
  return (
    <SupporterPreviewUpsell
      description="Make a teammate for each kind of work you do, like an editor for your drafts, a researcher for your sources or a planner for your weekly review. Each one has its own instructions and memory. Copilot Teammates is a preview for Supporters."
      points={TEAMMATES_POINTS}
      media={video ? <UpsellVideoThumbnail video={video} /> : undefined}
      medium={medium}
      onClose={onClose}
    />
  );
}

export class CustomAgentsUpsellModal extends ReactModal {
  constructor(
    app: App,
    private readonly medium: CustomAgentsUpsellMedium
  ) {
    super(app);
    this.titleEl.createSpan({ text: "Build your AI team with " });
    this.titleEl.createSpan({ cls: "tw-text-accent", text: "Copilot Teammates" });
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CustomAgentsUpsellContent medium={this.medium} onClose={close} />;
  }
}
