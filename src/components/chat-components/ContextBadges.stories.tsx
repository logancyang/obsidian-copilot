import React from "react";
import { ContextActiveNoteBadge, ContextSelectedTextBadge } from "./ContextBadges";
import type { Meta, StoryObj } from "@/lib/story";
import type { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { TFile } from "obsidian";

const noteFixture: unknown = Object.create(TFile.prototype);
if (!(noteFixture instanceof TFile)) throw new Error("Expected a TFile fixture");
const note = noteFixture;
Object.assign(note, {
  path: "Research notes.md",
  basename: "Research notes",
  extension: "md",
});
const selection: NoteSelectedTextContext = {
  id: "research-excerpt",
  sourceType: "note",
  notePath: note.path,
  noteTitle: note.basename,
  content: "Compare the interview findings with the survey results.",
  startLine: 12,
  endLine: 14,
};
interface Props {
  includeActiveNote: boolean;
  selectedTextContexts: SelectedTextContext[];
}

function ContextAttachments({ includeActiveNote, selectedTextContexts }: Props) {
  return (
    <div className="tw-flex tw-flex-wrap tw-gap-1">
      {includeActiveNote && (
        <ContextActiveNoteBadge currentActiveFile={note} onRemove={() => undefined} />
      )}
      {selectedTextContexts.map((selectedText) => (
        <ContextSelectedTextBadge
          key={selectedText.id}
          selectedText={selectedText}
          onRemove={() => undefined}
        />
      ))}
    </div>
  );
}
const meta = {
  title: "Chat/Context Badges",
  component: ContextAttachments,
  args: {
    includeActiveNote: true,
    selectedTextContexts: [],
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const ActiveNoteOnly: StoryObj<Props> = {};
export const ActiveNoteAndSelection: StoryObj<Props> = {
  args: { selectedTextContexts: [selection] },
};
export const SelectionOnly: StoryObj<Props> = {
  args: { includeActiveNote: false, selectedTextContexts: [selection] },
};
export const SelectionFromAnotherNote: StoryObj<Props> = {
  args: {
    selectedTextContexts: [{ ...selection, notePath: "Interviews.md", noteTitle: "Interviews" }],
  },
};

export const LongSelection: StoryObj<Props> = {
  args: {
    selectedTextContexts: [
      {
        ...selection,
        content:
          "Compare the interview findings with the survey results.\n\nWhich customer needs appear in both sources, and which still need more evidence?",
      },
    ],
  },
};

export const WebSelection: StoryObj<Props> = {
  args: {
    includeActiveNote: false,
    selectedTextContexts: [
      {
        id: "web-excerpt",
        sourceType: "web",
        title: "Interview guide",
        url: "https://example.com/interviews",
        content: "Ask participants to describe their most recent experience.",
      },
    ],
  },
};
