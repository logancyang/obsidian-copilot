import {
  RelevantNotesShelfPanel,
  type RelevantNotesShelfPanelProps,
} from "@/agentMode/ui/RelevantNotesShelfPanel";
import {
  RelevantNotesPane,
  type RelevantNotesPaneProps,
} from "@/components/chat-components/ui/RelevantNotesPane";
import { RelevantNotesToolbar } from "@/components/chat-components/ui/RelevantNotesToolbar";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const titles = [
  "Design principles",
  "Product research",
  "Making relevant notes useful throughout a conversation",
  "Weekly planning",
];

function notes(status: RelevantNotesPaneProps["status"], count = 0): React.ReactNode {
  return (
    <div className="tw-flex tw-min-h-full tw-w-full tw-flex-1 tw-flex-col">
      <RelevantNotesToolbar activeFileName="Research notes" />
      <div className="tw-relative tw-min-h-0 tw-flex-1">
        <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
          <RelevantNotesPane
            status={status}
            noteRows={Array.from({ length: count }, (_, index) => (
              <div key={index} className="tw-flex tw-gap-2 tw-px-2.5 tw-py-1.5 tw-text-sm">
                <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-normal">
                  {titles[index % titles.length]}
                </span>
                <span className="tw-text-muted">{86 - index}%</span>
              </div>
            ))}
            actions={{
              miyoDownloadUrl: "https://www.miyo.md/",
              onOpenMiyoSettings: () => undefined,
              onRefresh: () => undefined,
              reviewIndexing: { destination: "miyo", onSelect: () => undefined },
            }}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Agent/Relevant Notes Shelf Panel",
  component: RelevantNotesShelfPanel,
  args: { onPopOut: () => undefined, children: notes("matches", 4) },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RelevantNotesShelfPanelProps>;

export default meta;

const render: StoryObj<RelevantNotesShelfPanelProps>["render"] = (args) => (
  <div className="tw-flex tw-h-48 tw-flex-col">
    <RelevantNotesShelfPanel {...meta.args} {...args} />
  </div>
);

export const Results: StoryObj<RelevantNotesShelfPanelProps> = { render };

export const OverflowingResults: StoryObj<RelevantNotesShelfPanelProps> = {
  render,
  args: { children: notes("matches", 24) },
};

export const Empty: StoryObj<RelevantNotesShelfPanelProps> = {
  render,
  args: { children: notes("idle") },
};

export const Loading: StoryObj<RelevantNotesShelfPanelProps> = {
  render,
  args: { children: notes("loading") },
};

export const SetupGuidance: StoryObj<RelevantNotesShelfPanelProps> = {
  render,
  args: { children: notes("disabled") },
};
