import React from "react";
import {
  ContextActiveNoteBadge,
  ContextActiveWebTabBadge,
  ContextNoteBadge,
  ContextSelectedTextBadge,
} from "./ContextBadges";
import type { Meta, StoryObj } from "@/lib/story";
import type {
  NoteSelectedTextContext,
  SelectedTextContext,
  WebSelectedTextContext,
  WebTabContext,
} from "@/types/message";
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
  activeWebTab: WebTabContext | null;
}

function ContextAttachments({ includeActiveNote, selectedTextContexts, activeWebTab }: Props) {
  return (
    <div className="tw-flex tw-flex-wrap tw-gap-1">
      {includeActiveNote && (
        <ContextActiveNoteBadge currentActiveFile={note} onRemove={() => undefined} />
      )}
      {activeWebTab && (
        <ContextActiveWebTabBadge activeWebTab={activeWebTab} onRemove={() => undefined} />
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
    activeWebTab: null,
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
export const ReadingViewSelection: StoryObj<Props> = {
  args: {
    includeActiveNote: false,
    selectedTextContexts: [
      {
        id: "reading-excerpt",
        sourceType: "note",
        notePath: note.path,
        noteTitle: note.basename,
        content: "Compare the interview findings with the survey results.",
        startLine: 0,
        endLine: 0,
      },
    ],
  },
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

const webSelection: WebSelectedTextContext = {
  id: "web-excerpt",
  sourceType: "web",
  title: "Interview guide",
  url: "https://example.com/interviews",
  content: "Ask participants to describe their most recent experience.",
};

export const WebSelection: StoryObj<Props> = {
  args: { includeActiveNote: false, selectedTextContexts: [webSelection] },
};

export const WebSelectionWithActiveWebTab: StoryObj<Props> = {
  args: {
    includeActiveNote: false,
    selectedTextContexts: [webSelection],
    activeWebTab: { url: webSelection.url, title: webSelection.title, isActive: true },
  },
};

function attachedFile(path: string): TFile {
  const file: unknown = Object.create(TFile.prototype);
  if (!(file instanceof TFile)) throw new Error("Expected a TFile fixture");
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return Object.assign(file, {
    path,
    basename: name.slice(0, dot),
    extension: name.slice(dot + 1),
  });
}

const attachedFiles = [
  "Research notes.md",
  "attachments/report.pdf",
  "attachments/sales q3.csv",
  "attachments/brief.docx",
].map(attachedFile);

export const AttachedFileTypes: StoryObj<Props> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-gap-1">
      {attachedFiles.map((file) => (
        <ContextNoteBadge key={file.path} note={file} onRemove={() => undefined} />
      ))}
    </div>
  ),
};
