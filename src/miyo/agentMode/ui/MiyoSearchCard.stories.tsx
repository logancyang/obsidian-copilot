import type { MiyoNote } from "@/miyo/agentMode/miyoSearchRun";
import { MiyoSearchCard } from "@/miyo/agentMode/ui/MiyoSearchCard";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type MiyoSearchCardProps = React.ComponentProps<typeof MiyoSearchCard>;

const FOUR_NOTES: MiyoNote[] = [
  { path: "Health/Standing desk setup.md" },
  { path: "Health/Back pain log.md" },
  { path: "Reading list.md" },
  { path: "Journal/2026/2026-09-14.md" },
];

const TWELVE_NOTES: MiyoNote[] = [
  ...FOUR_NOTES,
  { path: "Projects/Home office/Monitor arm comparison.md" },
  { path: "Projects/Home office/Chair shortlist.md" },
  { path: "Health/Physio exercises.md" },
  { path: "Journal/2026/2026-08-02.md" },
  {
    path: "Inbox/Ergonomics podcast notes from the episode on sit-stand rhythms and monitor height.md",
  },
  { path: "Areas/Work/Remote setup checklist.md" },
  { path: "Health/Sleep and posture.md" },
  { path: "Untitled 3.md" },
];

const noop = () => {};

const meta = {
  title: "Agent Mode/Miyo Search Card",
  component: MiyoSearchCard,
  args: {
    status: "completed",
    query: "back pain and standing desk",
    notes: FOUR_NOTES,
    open: false,
    onToggle: noop,
    onOpenNote: noop,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MiyoSearchCardProps>;
export default meta;

export const Running: StoryObj<MiyoSearchCardProps> = {
  args: { status: "in_progress", notes: null },
};

export const Completed: StoryObj<MiyoSearchCardProps> = {};

export const Expanded: StoryObj<MiyoSearchCardProps> = {
  args: { open: true },
};

export const ExpandedScrolling: StoryObj<MiyoSearchCardProps> = {
  args: { notes: TWELVE_NOTES, open: true },
};

export const ExpandedWithOtherMiyoFolders: StoryObj<MiyoSearchCardProps> = {
  args: {
    query: "sleep research",
    notes: [
      { path: "Health/Sleep and posture.md" },
      { folder: "Reading Notes", path: "Research/Why We Sleep.md" },
      { folder: "Research", path: "Interview with Dr. Okafor.pdf" },
    ],
    open: true,
  },
};

export const SingleNote: StoryObj<MiyoSearchCardProps> = {
  args: { query: "tariff code ZX-4471", notes: [{ path: "Work/Customs/Import codes.md" }] },
};

export const Empty: StoryObj<MiyoSearchCardProps> = {
  args: { query: "quarterly offsite agenda", notes: [] },
};

export const Failed: StoryObj<MiyoSearchCardProps> = {
  args: { status: "failed", notes: null },
};

export const FailedWithError: StoryObj<MiyoSearchCardProps> = {
  args: {
    status: "failed",
    notes: null,
    error:
      "Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: net::ERR_CONNECTION_REFUSED",
  },
};

export const CountUnavailable: StoryObj<MiyoSearchCardProps> = {
  args: { notes: null },
};

export const LongQuery: StoryObj<MiyoSearchCardProps> = {
  args: {
    query:
      "what did I decide about the migration plan for the shared calendar service and who owns the rollout checklist",
    notes: TWELVE_NOTES,
  },
};
