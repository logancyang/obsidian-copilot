import { ReactModal } from "@/components/modals/ReactModal";
import { SupporterPreviewUpsell } from "@/components/modals/SupporterPreviewUpsell";
import type { ProductUtmMedium } from "@/lib/productLinks";
import type { App } from "obsidian";
import * as React from "react";

export const CUSTOM_AGENT_UPSELL_CLIP_URL = "";

export type CustomAgentsUpsellMedium = Extract<
  ProductUtmMedium,
  "custom_agent_dialog" | "custom_agent_mention"
>;

const CUSTOM_AGENT_POINTS = [
  "Correct an agent once and it remembers the rule",
  "@ another agent for a second opinion or to hand off a task",
  "Each agent's instructions and memory are notes in your vault you can edit",
];

export interface CustomAgentsUpsellContentProps {
  medium: CustomAgentsUpsellMedium;
  onClose: () => void;
  clipUrl?: string;
}

export function CustomAgentsUpsellContent({
  medium,
  onClose,
  clipUrl = CUSTOM_AGENT_UPSELL_CLIP_URL,
}: CustomAgentsUpsellContentProps): React.ReactElement {
  return (
    <SupporterPreviewUpsell
      description="Each agent gives its best answer from its own instructions and memory."
      points={CUSTOM_AGENT_POINTS}
      media={
        clipUrl ? (
          // Width cap keeps the 16:9 clip under 40vh tall so the footer buttons fit short windows: https://github.com/Brevilabs/obsidian-copilot-private/issues/582
          <img
            alt="Coco asks Maya for a second opinion, brings her answer back, remembers a rule, then the team of five agents"
            className="tw-mx-auto tw-block tw-h-auto tw-w-full tw-max-w-[calc(40vh*16/9)] tw-rounded-md tw-border tw-border-solid tw-border-border"
            height={720}
            src={clipUrl}
            width={1280}
          />
        ) : undefined
      }
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
    this.titleEl.createSpan({ cls: "tw-text-accent", text: "Copilot Teammates" });
    this.titleEl.createSpan({ text: " is a preview for Supporters" });
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CustomAgentsUpsellContent medium={this.medium} onClose={close} />;
  }
}
