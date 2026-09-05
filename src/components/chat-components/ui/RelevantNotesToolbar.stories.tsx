import {
  RelevantNotesToolbar,
  type RelevantNotesToolbarProps,
} from "@/components/chat-components/ui/RelevantNotesToolbar";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Chat/Relevant Notes Toolbar",
  component: RelevantNotesToolbar,
  args: {
    activeFileName: "2026-W18 Weekly Review",
    liveUpdate: { enabled: true, onChange: () => undefined },
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RelevantNotesToolbarProps>;

export default meta;

export const LiveUpdateOn: StoryObj<RelevantNotesToolbarProps> = {};

export const LiveUpdateOff: StoryObj<RelevantNotesToolbarProps> = {
  args: { liveUpdate: { enabled: false, onChange: () => undefined } },
};

export const MiyoDisconnected: StoryObj<RelevantNotesToolbarProps> = {
  args: { liveUpdate: undefined },
};

export const NoActiveNote: StoryObj<RelevantNotesToolbarProps> = {
  args: { activeFileName: undefined },
};

export const LongNoteName: StoryObj<RelevantNotesToolbarProps> = {
  args: { activeFileName: "Notes on distributed consensus and the FLP impossibility result" },
};
