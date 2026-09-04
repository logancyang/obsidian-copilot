import {
  RelevantNotesPane,
  type RelevantNotesPaneProps,
} from "@/components/chat-components/ui/RelevantNotesPane";
import type { Meta, StoryObj } from "@/lib/story";
import { FileInput, FileOutput } from "lucide-react";
import React from "react";

function NoteRows(): React.ReactNode[] {
  return [
    { title: "Design principles", score: 0.86, outgoing: true, backlink: false },
    { title: "Product research", score: 0.72, outgoing: false, backlink: true },
  ].map((note) => (
    <div
      key={note.title}
      className="tw-flex tw-min-h-8 tw-items-center tw-gap-2 tw-rounded-md tw-px-2.5 tw-py-1.5"
    >
      <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium tw-text-normal">
        {note.title}
      </span>
      {note.outgoing && <FileOutput className="tw-size-3 tw-text-faint" />}
      {note.backlink && <FileInput className="tw-size-3 tw-text-faint" />}
      <span className="tw-text-xs tw-font-medium tw-tabular-nums tw-text-muted">
        {Math.round(note.score * 100)}%
      </span>
    </div>
  ));
}

const baseArgs: RelevantNotesPaneProps = {
  status: "matches",
  noteRows: NoteRows(),
  actions: {
    miyoDownloadUrl: "https://www.miyo.md/",
    onOpenMiyoSettings: () => undefined,
    onRefresh: () => undefined,
    reviewIndexing: {
      destination: "miyo",
      onSelect: () => undefined,
    },
  },
};

const meta = {
  title: "Chat/Relevant Notes Pane",
  component: RelevantNotesPane,
  args: baseArgs,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RelevantNotesPaneProps>;

export default meta;

export const ConnectedScoredResults: StoryObj<RelevantNotesPaneProps> = {};

export const MatchedFilesUnavailable: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "matches", noteRows: [] },
};

export const NoActiveNote: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "idle", noteRows: [] },
};

export const Loading: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "loading", noteRows: [] },
};

export const NoMiyoEmptyGuidance: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "disabled", noteRows: [] },
};

export const MiyoUnavailableEmptyGuidance: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "unavailable", noteRows: [] },
};

export const EmptyNoSemanticMatches: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "no-matches", noteRows: [] },
};

export const NotIndexedGuidance: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "not-indexed", noteRows: [] },
};

export const NotIndexedRemoteGuidance: StoryObj<RelevantNotesPaneProps> = {
  args: {
    status: "not-indexed",
    noteRows: [],
    actions: {
      ...baseArgs.actions,
      reviewIndexing: { ...baseArgs.actions.reviewIndexing, destination: "settings" },
    },
  },
};
